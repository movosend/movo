import json
import logging
from datetime import datetime

from ortools.constraint_solver import pywrapcp, routing_enums_pb2
from redis.asyncio import Redis

from app.config import settings
from app.models.evaluate import (
    CandidateEvaluation,
    CandidatePackage,
    EvaluateCandidatesRequest,
    EvaluateCandidatesResponse,
)
from app.models.optimize import Coordinates
from app.services.redis_client import get_redis_client
from app.services.routes_provider import (
    DistanceMatrixResult,
    RoutesProvider,
    get_routes_provider,
)

logger = logging.getLogger(__name__)


def parse_time_window_minutes(
    val: str | datetime | int | float | None, base_dt: datetime
) -> int | None:
    """Retorna los minutos relativos a base_dt (negativo si el horario es anterior a base_dt)."""
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return int(val)
    if isinstance(val, datetime):
        return int((val.astimezone() - base_dt.astimezone()).total_seconds() / 60.0)

    val_str = str(val).strip()
    try:
        dt = datetime.fromisoformat(val_str.replace("Z", "+00:00"))
        if dt.tzinfo is not None and base_dt.tzinfo is None:
            base_tz = base_dt.astimezone()
        elif dt.tzinfo is None and base_dt.tzinfo is not None:
            dt = dt.replace(tzinfo=base_dt.tzinfo)
            base_tz = base_dt
        else:
            base_tz = base_dt
        return int((dt - base_tz).total_seconds() / 60.0)
    except ValueError:
        pass

    parts = val_str.split(":")
    if len(parts) >= 2:
        try:
            h = int(parts[0])
            m = int(parts[1])
            s = int(parts[2]) if len(parts) > 2 else 0
            from datetime import time as dt_time

            target_time = dt_time(h, m, s)
            target_dt = datetime.combine(base_dt.date(), target_time, tzinfo=base_dt.tzinfo)
            return int((target_dt - base_dt).total_seconds() / 60.0)
        except (ValueError, TypeError):
            pass

    return None


class CandidateEvaluator:
    """Evaluador de desvío marginal y factibilidad para paquetes candidatos (MOVO-218)."""

    def __init__(
        self,
        routes_provider: RoutesProvider | None = None,
        redis: Redis | None = None,
    ) -> None:
        self.routes_provider = routes_provider or get_routes_provider()
        self.redis = redis if redis is not None else get_redis_client()

    async def evaluate_candidates(
        self, request: EvaluateCandidatesRequest
    ) -> EvaluateCandidatesResponse:
        trip = request.trip
        origin_coord = Coordinates(lat=trip.origin_lat, lng=trip.origin_lng)
        dest_coord = Coordinates(lat=trip.destination_lat, lng=trip.destination_lng)

        # 1. Cálculo de trayecto directo (Origen -> Destino)
        direct_matrix: DistanceMatrixResult = self.routes_provider.compute_matrix(
            [origin_coord, dest_coord]
        )
        direct_distance_km = round(direct_matrix.dist_matrix_km[0][1], 2)
        direct_duration_minutes = direct_matrix.time_matrix_min[0][1]

        # Parsear hora base de partida del viaje
        base_dt = (
            trip.departure_at
            if isinstance(trip.departure_at, datetime)
            else datetime.fromisoformat(str(trip.departure_at).replace("Z", "+00:00"))
        )

        evaluations: list[CandidateEvaluation] = []

        # 2. Evaluación por candidato (Cache-First)
        for candidate in request.candidates:
            cache_key = f"route_solution:{trip.id}:{candidate.id}"

            # 2.1 Cache HIT check en Redis
            if self.redis is not None:
                try:
                    cached_raw = await self.redis.get(cache_key)
                    if cached_raw:
                        cached_data = json.loads(cached_raw)
                        # Sliding expiration: refrescar el TTL al ser consultado
                        try:
                            await self.redis.expire(
                                cache_key, settings.routing_cache_ttl_seconds
                            )
                        except Exception as exp_err:
                            logger.debug("Fallo al refrescar TTL de cache: %s", exp_err)

                        evaluations.append(
                            CandidateEvaluation(
                                candidate_id=candidate.id,
                                feasible=True,
                                detour_distance_km=cached_data.get("detourDistanceKm"),
                                detour_duration_minutes=cached_data.get("detourDurationMinutes"),
                                total_distance_km=cached_data.get("totalDistanceKm"),
                                total_duration_minutes=cached_data.get("totalDurationMinutes"),
                            )
                        )
                        continue
                except Exception as e:
                    logger.warning(f"Fallo al consultar cache Redis para clave {cache_key}: {e}")

            # 2.2 Cache MISS: Resolver circuito de 4 nodos con OR-Tools
            evaluation = await self._solve_candidate(
                trip=trip,
                candidate=candidate,
                origin_coord=origin_coord,
                dest_coord=dest_coord,
                base_dt=base_dt,
                direct_distance_km=direct_distance_km,
                direct_duration_minutes=direct_duration_minutes,
                cache_key=cache_key,
            )
            evaluations.append(evaluation)

        is_mock = self.routes_provider.compute_matrix([]).provider_name == "haversine_mock"
        calc_method = "haversine_vrptw_v1" if is_mock else "google_routes_vrptw_v1"

        return EvaluateCandidatesResponse(
            direct_distance_km=direct_distance_km,
            direct_duration_minutes=direct_duration_minutes,
            evaluations=evaluations,
            calculation_method=calc_method,
        )

    async def _solve_candidate(
        self,
        trip,
        candidate: CandidatePackage,
        origin_coord: Coordinates,
        dest_coord: Coordinates,
        base_dt: datetime,
        direct_distance_km: float,
        direct_duration_minutes: int,
        cache_key: str,
    ) -> CandidateEvaluation:
        """Modela y resuelve el problema de 4 nodos (Origen -> Pickup -> Dropoff -> Destino)."""
        pickup_coord = Coordinates(lat=candidate.pickup_lat, lng=candidate.pickup_lng)
        dropoff_coord = Coordinates(lat=candidate.dropoff_lat, lng=candidate.dropoff_lng)

        # Nodos: 0: Origen, 1: Pickup, 2: Dropoff, 3: Destino
        waypoints = [origin_coord, pickup_coord, dropoff_coord, dest_coord]
        matrix: DistanceMatrixResult = self.routes_provider.compute_matrix(waypoints)

        default_svc = settings.routing_default_service_time_minutes
        cand_svc = (
            candidate.service_time_minutes
            if candidate.service_time_minutes is not None
            else default_svc
        )
        service_times = [0, cand_svc, cand_svc, 0]

        # Configurar OR-Tools Routing: 4 nodos, 1 vehículo, salida=0, llegada=3
        manager = pywrapcp.RoutingIndexManager(4, 1, [0], [3])
        routing = pywrapcp.RoutingModel(manager)

        def transit_callback(from_idx: int, to_idx: int) -> int:
            from_node = manager.IndexToNode(from_idx)
            to_node = manager.IndexToNode(to_idx)
            travel_min = matrix.time_matrix_min[from_node][to_node]
            return travel_min + service_times[from_node]

        transit_callback_index = routing.RegisterTransitCallback(transit_callback)
        routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)

        # Dimensión de tiempo con holgura (slack)
        slack_min = settings.routing_time_slack_minutes
        horizon_min = 2880  # 48 hs
        routing.AddDimension(
            transit_callback_index,
            slack_min,
            horizon_min,
            True,
            "Time",
        )
        time_dim = routing.GetDimensionOrDie("Time")
        time_dim.CumulVar(routing.Start(0)).SetRange(0, 0)

        # Precedencia obligatoria: Pickup (1) antes de Dropoff (2)
        p_idx = manager.NodeToIndex(1)
        d_idx = manager.NodeToIndex(2)
        routing.AddPickupAndDelivery(p_idx, d_idx)
        solver = routing.solver()
        solver.Add(routing.VehicleVar(p_idx) == routing.VehicleVar(d_idx))
        solver.Add(time_dim.CumulVar(p_idx) + service_times[1] <= time_dim.CumulVar(d_idx))

        # Configurar ventanas horarias para Pickup (1) y Dropoff (2)
        p_start_min = parse_time_window_minutes(candidate.pickup_window_start, base_dt)
        p_end_min = parse_time_window_minutes(candidate.pickup_window_end, base_dt)
        d_start_min = parse_time_window_minutes(candidate.dropoff_window_start, base_dt)
        d_end_min = parse_time_window_minutes(candidate.dropoff_window_end, base_dt)

        # Si alguna ventana cerró antes de la partida (aún sumando la holgura), es inviable
        if (p_end_min is not None and p_end_min + slack_min < 0) or (
            d_end_min is not None and d_end_min + slack_min < 0
        ):
            return CandidateEvaluation(candidate_id=candidate.id, feasible=False)

        self._apply_time_window(time_dim, p_idx, p_start_min, p_end_min, slack_min)
        self._apply_time_window(time_dim, d_idx, d_start_min, d_end_min, slack_min)

        # Resolver
        search_params = pywrapcp.DefaultRoutingSearchParameters()
        search_params.first_solution_strategy = (
            routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
        )
        search_params.time_limit.seconds = int(settings.routing_time_limit_seconds) or 1

        solution = routing.SolveWithParameters(search_params)
        if solution is None:
            return CandidateEvaluation(candidate_id=candidate.id, feasible=False)

        # Recorrer la ruta resuelta: 0 -> 1 -> 2 -> 3
        total_dist_km = (
            matrix.dist_matrix_km[0][1]
            + matrix.dist_matrix_km[1][2]
            + matrix.dist_matrix_km[2][3]
        )
        total_distance_km = round(total_dist_km, 2)
        total_duration_minutes = solution.Min(time_dim.CumulVar(routing.End(0)))

        detour_distance_km = max(0.0, round(total_distance_km - direct_distance_km, 2))
        detour_duration_minutes = max(0, total_duration_minutes - direct_duration_minutes)

        # Persistir en Redis con TTL de 30 minutos
        if self.redis is not None:
            try:
                solution_data = {
                    "tripId": trip.id,
                    "candidateId": candidate.id,
                    "feasible": True,
                    "detourDistanceKm": detour_distance_km,
                    "detourDurationMinutes": detour_duration_minutes,
                    "totalDistanceKm": total_distance_km,
                    "totalDurationMinutes": total_duration_minutes,
                    "stops": [
                        {"stopOrder": 0, "type": "origin", "lat": trip.origin_lat, "lng": trip.origin_lng},
                        {"stopOrder": 1, "type": "pickup", "shipmentId": candidate.id, "lat": candidate.pickup_lat, "lng": candidate.pickup_lng},
                        {"stopOrder": 2, "type": "dropoff", "shipmentId": candidate.id, "lat": candidate.dropoff_lat, "lng": candidate.dropoff_lng},
                        {"stopOrder": 3, "type": "destination", "lat": trip.destination_lat, "lng": trip.destination_lng},
                    ],
                    "calculatedAt": datetime.now().isoformat(),
                }
                await self.redis.set(
                    cache_key,
                    json.dumps(solution_data),
                    ex=settings.routing_cache_ttl_seconds,
                )
            except Exception as e:
                logger.warning(f"Error al escribir en Redis clave {cache_key}: {e}")

        return CandidateEvaluation(
            candidate_id=candidate.id,
            feasible=True,
            detour_distance_km=detour_distance_km,
            detour_duration_minutes=detour_duration_minutes,
            total_distance_km=total_distance_km,
            total_duration_minutes=total_duration_minutes,
        )

    def _apply_time_window(
        self,
        time_dim,
        node_idx: int,
        start_min: int | None,
        end_min: int | None,
        slack_min: int,
    ) -> None:
        """Aplica las restricciones de ventana horaria respetando la holgura configurada."""
        if start_min is not None and start_min > 0:
            time_dim.CumulVar(node_idx).SetMin(start_min)

        if end_min is not None:
            # Cota dura: no puede exceder el fin de ventana + slack de 120 min
            time_dim.CumulVar(node_idx).SetRange(0, end_min + slack_min)
            # Cota suave: penaliza si llega después del fin de ventana
            time_dim.SetCumulVarSoftUpperBound(node_idx, end_min, 1000)
