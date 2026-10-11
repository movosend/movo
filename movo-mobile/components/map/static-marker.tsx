import { useEffect, useState, type ReactNode } from "react";
import { Marker, type LatLng } from "react-native-maps";

/**
 * Marcador con vista propia que deja de redibujarse a los 600 ms. Mientras
 * `tracksViewChanges` está activo el mapa vuelve a rasterizar la vista a cada rato (en
 * Android redibuja el bitmap en cada frame: parpadeo, batería y lag al scrollear), así que
 * se apaga después de un margen para que cargue el contenido. Si el contenido cambia (ej.
 * otra dirección), el caller tiene que remontarlo con un `key` para que vuelva a medirse.
 */
export function StaticMarker({
  coordinate,
  anchor = { x: 0.5, y: 0.5 },
  children,
}: {
  coordinate: LatLng;
  anchor?: { x: number; y: number };
  children: ReactNode;
}) {
  const [track, setTrack] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setTrack(false), 600);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Marker coordinate={coordinate} anchor={anchor} tracksViewChanges={track}>
      {children}
    </Marker>
  );
}
