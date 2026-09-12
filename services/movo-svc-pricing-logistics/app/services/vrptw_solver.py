from dataclasses import dataclass
from datetime import datetime, time as dt_time, timedelta
import logging
import math

from ortools.constraint_solver import pywrapcp, routing_enums_pb2

from app.config import settings
from app.models.optimize import (
    Coordinates,
    OptimizationStatus,
    OptimizeRouteRequest,
    OptimizeRouteResponse,
    RouteStopInput,
    RouteStopOutput,
    StopType,
)
from app.services.routes_provider import (
    DistanceMatrixResult,
    MockRoutesProvider,
    RoutesProvider,
    get_routes_provider,
)

logger = logging.getLogger(__name__)


class RoutingInfeasibleError(Exception):
    """Lanzada cuando el solver no encuentra solución factible o viola restricciones (No-Fallback)."""

    def __init__(self, message: str = "No se pudo encontrar una ruta factible que satisfaga las restricciones."):
        super().__init__(message)
        self.status_code = 422


@dataclass
class InternalNode:
    node_id: int
    name: str
    lat: float
    lng: float
    stop_type: StopType | None  # None para salida / llegada / dummy
    shipment_id: str | None
    address: str | None
    window_start_min: int | None
    window_end_min: int | None
    service_time_min: int
    raw_window_start: str | None
    raw_window_end: str | None


def _parse_time_window(val: str | datetime | int | float | None, base_dt: datetime) -> tuple[int | None, str | None]:
    """Convierte un valor de ventana horaria a minutos desde base_dt y un string legible."""
    if val is None:
        return None, None

    if isinstance(val, (int, float)):
        return int(val), str(val)

    if isinstance(val, datetime):
        raw_str = val.isoformat()
        diff_minutes = int((val.astimezone() - base_dt.astimezone()).total_seconds() / 60.0)
        return max(0, diff_minutes), raw_str

    val_str = str(val).strip()
    # Intentar parsear ISO 8601
    try:
        dt = datetime.fromisoformat(val_str.replace("Z", "+00:00"))
        # Si tiene timezone, comparar con base_dt con timezone
        if dt.tzinfo is not None and base_dt.tzinfo is None:
            base_tz = base_dt.astimezone()
        elif dt.tzinfo is None and base_dt.tzinfo is not None:
            dt = dt.replace(tzinfo=base_dt.tzinfo)
            base_tz = base_dt
        else:
            base_tz = base_dt
        diff_minutes = int((dt - base_tz).total_seconds() / 60.0)
        return max(0, diff_minutes), val_str
    except ValueError:
        pass

    # Intentar parsear formato hora "HH:MM[:SS]"
    parts = val_str.split(":")
    if len(parts) >= 2:
        try:
            h = int(parts[0])
            m = int(parts[1])
            s = int(parts[2]) if len(parts) > 2 else 0
            target_time = dt_time(h, m, s)
            target_dt = datetime.combine(base_dt.date(), target_time, tzinfo=base_dt.tzinfo)
            diff_minutes = int((target_dt - base_dt).total_seconds() / 60.0)
            return max(0, diff_minutes), val_str
        except (ValueError, TypeError):
            pass

    return None, val_str


class VRPTWSolver:
    """Optimizador de rutas multi-envío con ventanas horarias y precedencia mediante Google OR-Tools.

    Cumple con los requerimientos de MOVO-205, MOVO-50 y ADR-013/015:
    - Restricción de precedencia dura: retiro antes que entrega (AC2).
    - Ventanas horarias con penalización suave para no fallar en agendas atrasadas (AC3).
    - Tiempo límite configurable (AC4).
    - Abstracción RoutesProvider (AC6 / MOVO-217).
    - Política No-Fallback: lanza excepción en vez de solución silenciosamente degradada.
    """

    def __init__(self, provider: RoutesProvider | None = None):
        self.provider = provider or get_routes_provider()

    def optimize(self, request: OptimizeRouteRequest) -> OptimizeRouteResponse:
        # Caso 1: Ruta vacía (0 paradas)
        if not request.stops:
            is_mock = isinstance(self.provider, MockRoutesProvider)
            return OptimizeRouteResponse(
                stops=[],
                total_distance_km=0.0,
                total_duration_minutes=0.0,
                status=OptimizationStatus.EMPTY,
                calculation_method="haversine_vrptw_v1" if is_mock else "google_routes_vrptw_v1",
                disclaimer="Ruta sin paradas asignadas.",
            )

        # Determinar base timestamp de partida
        if request.departure_time is not None:
            if isinstance(request.departure_time, datetime):
                base_dt = request.departure_time
            else:
                try:
                    base_dt = datetime.fromisoformat(
                        str(request.departure_time).replace("Z", "+00:00")
                    )
                except ValueError:
                    base_dt = datetime.now()
        else:
            base_dt = datetime.now()

        # Separar paradas en retiros (pickups) y entregas (dropoffs) para orden canónico
        pickups: list[RouteStopInput] = [s for s in request.stops if s.type == StopType.PICKUP]
        dropoffs: list[RouteStopInput] = [s for s in request.stops if s.type == StopType.DELIVERY]

        # Construir waypoints canónicos:
        # [Salida, Pickup 1..n, Dropoff 1..n, (Llegada final si fue declarada)]
        canonical_waypoints: list[Coordinates] = [request.carrier_location]
        for p in pickups:
            canonical_waypoints.append(Coordinates(lat=p.lat, lng=p.lng))
        for d in dropoffs:
            canonical_waypoints.append(Coordinates(lat=d.lat, lng=d.lng))

        has_final_location = request.final_location is not None
        if request.final_location is not None:
            canonical_waypoints.append(request.final_location)

        # Consultar la matriz de distancias y tiempos vía RoutesProvider
        matrix_result: DistanceMatrixResult = self.provider.compute_matrix(canonical_waypoints)
        dist_matrix = [row[:] for row in matrix_result.dist_matrix_km]
        time_matrix = [row[:] for row in matrix_result.time_matrix_min]

        # Crear nodos internos estructurados
        internal_nodes: list[InternalNode] = []
        default_svc = settings.routing_default_service_time_minutes

        # Nodo 0: Ubicación actual del transportista
        internal_nodes.append(
            InternalNode(
                node_id=0,
                name="Salida: Posición actual",
                lat=request.carrier_location.lat,
                lng=request.carrier_location.lng,
                stop_type=None,
                shipment_id=None,
                address=None,
                window_start_min=0,
                window_end_min=None,
                service_time_min=0,
                raw_window_start=None,
                raw_window_end=None,
            )
        )

        curr_id = 1
        # Nodos 1..P: Pickups
        for p in pickups:
            w_start, raw_start = _parse_time_window(p.time_window_start, base_dt)
            w_end, raw_end = _parse_time_window(p.time_window_end, base_dt)
            svc = p.service_time_minutes if p.service_time_minutes is not None else default_svc
            internal_nodes.append(
                InternalNode(
                    node_id=curr_id,
                    name=f"PICKUP: {p.shipment_id}",
                    lat=p.lat,
                    lng=p.lng,
                    stop_type=StopType.PICKUP,
                    shipment_id=p.shipment_id,
                    address=p.address,
                    window_start_min=w_start,
                    window_end_min=w_end,
                    service_time_min=svc,
                    raw_window_start=raw_start,
                    raw_window_end=raw_end,
                )
            )
            curr_id += 1

        # Nodos P+1..P+D: Dropoffs
        for d in dropoffs:
            w_start, raw_start = _parse_time_window(d.time_window_start, base_dt)
            w_end, raw_end = _parse_time_window(d.time_window_end, base_dt)
            svc = d.service_time_minutes if d.service_time_minutes is not None else default_svc
            internal_nodes.append(
                InternalNode(
                    node_id=curr_id,
                    name=f"DELIVERY: {d.shipment_id}",
                    lat=d.lat,
                    lng=d.lng,
                    stop_type=StopType.DELIVERY,
                    shipment_id=d.shipment_id,
                    address=d.address,
                    window_start_min=w_start,
                    window_end_min=w_end,
                    service_time_min=svc,
                    raw_window_start=raw_start,
                    raw_window_end=raw_end,
                )
            )
            curr_id += 1

        # Si no hay destino final declarado, agregamos un nodo dummy final con costo 0 (ruta abierta)
        if request.final_location is not None:
            internal_nodes.append(
                InternalNode(
                    node_id=curr_id,
                    name="Llegada: Destino declarado",
                    lat=request.final_location.lat,
                    lng=request.final_location.lng,
                    stop_type=None,
                    shipment_id=None,
                    address=None,
                    window_start_min=None,
                    window_end_min=None,
                    service_time_min=0,
                    raw_window_start=None,
                    raw_window_end=None,
                )
            )
            end_node_id = curr_id
        else:
            # Dummy node para open routing
            dummy_node_id = curr_id
            internal_nodes.append(
                InternalNode(
                    node_id=dummy_node_id,
                    name="Dummy End",
                    lat=0.0,
                    lng=0.0,
                    stop_type=None,
                    shipment_id=None,
                    address=None,
                    window_start_min=None,
                    window_end_min=None,
                    service_time_min=0,
                    raw_window_start=None,
                    raw_window_end=None,
                )
            )
            end_node_id = dummy_node_id
            # Extender matrices con fila/columna dummy de costo 0 desde cualquier nodo
            for d_row in dist_matrix:
                d_row.append(0.0)
            for t_row in time_matrix:
                t_row.append(0)
            dist_matrix.append([0.0] * (dummy_node_id + 1))
            time_matrix.append([0] * (dummy_node_id + 1))

        num_nodes = len(internal_nodes)
        manager = pywrapcp.RoutingIndexManager(num_nodes, 1, [0], [end_node_id])
        routing = pywrapcp.RoutingModel(manager)

        # Transit Callback
        def transit_callback(from_index: int, to_index: int) -> int:
            from_node = manager.IndexToNode(from_index)
            to_node = manager.IndexToNode(to_index)
            return time_matrix[from_node][to_node] + internal_nodes[from_node].service_time_min

        transit_callback_index = routing.RegisterTransitCallback(transit_callback)
        routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)

        # Dimensión de Tiempo con Slack (holgura) de 120 min (2 horas)
        slack_min = settings.routing_time_slack_minutes
        horizon_min = 2880  # 48 horas de horizonte para no bloquear por cálculo de días
        routing.AddDimension(
            transit_callback_index,
            slack_min,
            horizon_min,
            True,  # fix_start_cumul_to_zero=True: ancla el inicio en t=0 (departure_time)
            "Time",
        )
        time_dimension = routing.GetDimensionOrDie("Time")
        # Fijar explícitamente el inicio en 0 para evitar desfasaje de los ETAs devueltos
        time_dimension.CumulVar(routing.Start(0)).SetRange(0, 0)

        # Configurar ventanas horarias en la dimensión de tiempo
        for node in internal_nodes:
            # El nodo dummy o de fin no restringe ventanas
            if node.node_id == end_node_id and not has_final_location:
                continue

            node_idx = (
                routing.Start(0)
                if node.node_id == 0
                else routing.End(0)
                if (has_final_location and node.node_id == end_node_id)
                else manager.NodeToIndex(node.node_id)
            )

            # Cota inferior (hora de inicio): el transportista espera si llega antes
            if node.window_start_min is not None and node.window_start_min > 0:
                time_dimension.CumulVar(node_idx).SetMin(node.window_start_min)

            # Cota superior (fin de ventana): cota suave con penalización para tolerar agendas atrasadas (AC3)
            if node.window_end_min is not None:
                # Penalización alta por minuto de retraso (1000 por min)
                time_dimension.SetCumulVarSoftUpperBound(node_idx, node.window_end_min, 1000)

        # Restricciones de Precedencia (AC2): Retiro siempre antes de entrega para un mismo shipment
        shipment_pickups: dict[str, int] = {}
        shipment_deliveries: dict[str, int] = {}

        for node in internal_nodes:
            if node.shipment_id and node.stop_type == StopType.PICKUP:
                shipment_pickups[node.shipment_id] = node.node_id
            elif node.shipment_id and node.stop_type == StopType.DELIVERY:
                shipment_deliveries[node.shipment_id] = node.node_id

        solver = routing.solver()
        for s_id, p_node in shipment_pickups.items():
            if s_id in shipment_deliveries:
                d_node = shipment_deliveries[s_id]
                p_idx = manager.NodeToIndex(p_node)
                d_idx = manager.NodeToIndex(d_node)

                routing.AddPickupAndDelivery(p_idx, d_idx)
                solver.Add(routing.VehicleVar(p_idx) == routing.VehicleVar(d_idx))
                # Precedencia obligatoria temporal: pickup <= delivery
                solver.Add(
                    time_dimension.CumulVar(p_idx) + internal_nodes[p_node].service_time_min
                    <= time_dimension.CumulVar(d_idx)
                )

        # Parámetros de búsqueda
        search_parameters = pywrapcp.DefaultRoutingSearchParameters()
        search_parameters.first_solution_strategy = (
            routing_enums_pb2.FirstSolutionStrategy.PARALLEL_CHEAPEST_INSERTION
        )
        search_parameters.local_search_metaheuristic = (
            routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
        )
        search_parameters.time_limit.seconds = max(1, int(math.ceil(settings.routing_time_limit_seconds)))

        solution = routing.SolveWithParameters(search_parameters)

        # Política No-Fallback: Si no hay solución factible, lanzar error HTTP 422
        if not solution:
            logger.warning("OR-Tools no encontró solución factible para la ruta.")
            raise RoutingInfeasibleError(
                "No fue posible encontrar una ruta factible que cumpla con las restricciones."
            )

        # Reconstruir la ruta ordenada
        ordered_stops: list[RouteStopOutput] = []
        total_dist_km = 0.0
        total_time_min = 0.0
        index = routing.Start(0)
        stop_order = 0

        visited_shipment_pickups: set[str] = set()

        while not routing.IsEnd(index):
            node_id = manager.IndexToNode(index)
            node = internal_nodes[node_id]

            if node.stop_type is not None:
                assert node.shipment_id is not None
                arr_min = solution.Min(time_dimension.CumulVar(index))
                dep_min = arr_min + node.service_time_min

                # Chequear si está fuera de ventana pactada (AC3)
                outside = False
                if node.window_end_min is not None and arr_min > node.window_end_min:
                    outside = True

                arr_dt = base_dt + timedelta(minutes=arr_min)
                dep_dt = base_dt + timedelta(minutes=dep_min)

                # Validar precedencia: si es delivery, el pickup de su shipment ya debió haber sido visitado
                if node.stop_type == StopType.PICKUP:
                    visited_shipment_pickups.add(node.shipment_id)
                elif node.stop_type == StopType.DELIVERY:
                    if node.shipment_id in shipment_pickups and node.shipment_id not in visited_shipment_pickups:
                        logger.error("Violación de precedencia detectada en solución de OR-Tools para shipment %s", node.shipment_id)
                        raise RoutingInfeasibleError(
                            f"La solución generada viola la precedencia para el envío {node.shipment_id}."
                        )

                ordered_stops.append(
                    RouteStopOutput(
                        stop_order=stop_order,
                        shipment_id=node.shipment_id,
                        type=node.stop_type,
                        lat=node.lat,
                        lng=node.lng,
                        address=node.address,
                        estimated_arrival_minutes=float(arr_min),
                        estimated_arrival_at=arr_dt.isoformat(),
                        estimated_departure_at=dep_dt.isoformat(),
                        time_window_start=node.raw_window_start,
                        time_window_end=node.raw_window_end,
                        outside_time_window=outside,
                    )
                )
                stop_order += 1

            next_index = solution.Value(routing.NextVar(index))
            next_node_id = manager.IndexToNode(next_index)

            # Sumar distancias y tiempos reales (excluyendo el arco hacia el dummy end)
            if not (next_node_id == end_node_id and not has_final_location):
                total_dist_km += dist_matrix[node_id][next_node_id]
                total_time_min += time_matrix[node_id][next_node_id] + node.service_time_min

            index = next_index

        status = (
            OptimizationStatus.OPTIMAL
            if routing.status() == routing_enums_pb2.RoutingSearchStatus.ROUTING_SUCCESS
            else OptimizationStatus.FEASIBLE
        )

        calc_method = (
            "haversine_vrptw_v1"
            if matrix_result.provider_name == "haversine_mock"
            else "google_routes_vrptw_v1"
        )
        disclaimer = (
            "Distancias calculadas con Haversine y tiempos estimados con velocidad promedio configurable "
            f"({settings.routing_avg_speed_kmh} km/h). Estimación geométrica sin tráfico real (ADR-013)."
            if matrix_result.provider_name == "haversine_mock"
            else "Ruta optimizada con distancias y tiempos de Google Routes API (tier Basic, ADR-015)."
        )

        return OptimizeRouteResponse(
            stops=ordered_stops,
            total_distance_km=round(total_dist_km, 2),
            total_duration_minutes=round(total_time_min, 1),
            status=status,
            calculation_method=calc_method,
            disclaimer=disclaimer,
        )


def optimize_route(request: OptimizeRouteRequest, provider: RoutesProvider | None = None) -> OptimizeRouteResponse:
    """Función de entrada para resolver el problema VRPTW sobre el request dado."""
    solver = VRPTWSolver(provider=provider)
    return solver.optimize(request)
