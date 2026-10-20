import { selectCurrentStep, useTourStore } from "../src/store/tour-store";
import { shouldAutoShowTour } from "../src/tours/types";
import { TOURS } from "../src/tours";

function stepIds() {
  return useTourStore.getState().active?.steps.map((step) => step.id) ?? [];
}

describe("tour-store (MOVO-169)", () => {
  beforeEach(() => {
    useTourStore.setState({ active: null, anchors: {}, pending: [], pendingLoaded: false });
  });

  it("Tour 1 sin requisitos: termina en el checklist de Transportar, 6 pasos", () => {
    useTourStore.getState().startTour("first_steps", { context: { firstName: "Pauli", canBrowse: false } });

    expect(stepIds()).toEqual(["welcome", "send", "recent", "chat", "transport-tab", "requirements"]);
  });

  it("Tour 1 con todo listo: el último paso pasa a '¡Ya podés transportar!' en Inicio", () => {
    useTourStore.getState().startTour("first_steps", { context: { canBrowse: true } });

    const steps = useTourStore.getState().active?.steps ?? [];
    expect(steps).toHaveLength(6);
    expect(steps[5]).toMatchObject({ id: "ready", title: "¡Ya podés transportar!", route: "/home" });
    expect(steps[5].anchorId).toBeUndefined();
  });

  it("Tour 2 sin envíos en el feed: el paso de la primera fila no entra y quedan 4", () => {
    useTourStore.getState().startTour("carrier", { context: { canBrowse: true, hasFeed: false } });

    expect(stepIds()).toEqual(["welcome", "trips", "radius", "offers"]);
  });

  it("avanza y retrocede sin salirse de los límites", () => {
    const store = useTourStore.getState();
    store.startTour("carrier", { context: { hasFeed: true } });

    store.prev();
    expect(useTourStore.getState().active?.index).toBe(0);
    store.next();
    store.next();
    expect(selectCurrentStep(useTourStore.getState())?.id).toBe("radius");
    store.prev();
    expect(selectCurrentStep(useTourStore.getState())?.id).toBe("trips");
    for (let i = 0; i < 10; i++) store.next();
    expect(selectCurrentStep(useTourStore.getState())?.id).toBe("offers");
  });

  it("saltear un paso sin ancla recalcula el total y sigue en la misma dirección", () => {
    const store = useTourStore.getState();
    store.startTour("carrier", { context: { hasFeed: true } });
    store.next();
    store.next();
    store.next(); // feed

    store.skipCurrentStep();
    expect(selectCurrentStep(useTourStore.getState())?.id).toBe("offers");
    expect(useTourStore.getState().active?.steps).toHaveLength(4);

    store.prev(); // radius
    store.skipCurrentStep();
    expect(selectCurrentStep(useTourStore.getState())?.id).toBe("trips");
    expect(useTourStore.getState().active?.steps).toHaveLength(3);
  });

  it("finish devuelve si el tour fue relanzado a mano y lo cierra", () => {
    useTourStore.getState().startTour("first_steps", { manual: true });

    expect(useTourStore.getState().finish()).toEqual({ tourId: "first_steps", manual: true });
    expect(useTourStore.getState().active).toBeNull();
    expect(useTourStore.getState().finish()).toBeNull();
  });

  it("al desmontar un ancla no borra la que registró otra instancia con el mismo id", () => {
    const measure = jest.fn();
    const store = useTourStore.getState();
    const unregisterFirst = store.registerAnchor("a", { measure, radius: 0, padding: 0 });
    const second = { measure, radius: 1, padding: 0 };
    store.registerAnchor("a", second);

    unregisterFirst();

    expect(useTourStore.getState().anchors.a).toBe(second);
  });

  describe("shouldAutoShowTour", () => {
    it("muestra si no hay registro o si el registrado es de una versión anterior", () => {
      const tour = TOURS.first_steps;
      expect(shouldAutoShowTour(tour, [])).toBe(true);
      expect(shouldAutoShowTour(tour, [{ tourId: "carrier", version: 1, outcome: "completed" }])).toBe(true);
      expect(shouldAutoShowTour(tour, [{ tourId: "first_steps", version: tour.version, outcome: "skipped" }])).toBe(false);
      expect(
        shouldAutoShowTour({ ...tour, version: tour.version + 1 }, [
          { tourId: "first_steps", version: tour.version, outcome: "completed" },
        ]),
      ).toBe(true);
    });
  });
});
