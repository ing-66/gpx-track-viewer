import L from 'leaflet';
import buffer from '@turf/buffer';
import distance from '@turf/distance';
import bearing from '@turf/bearing';
import { lineString, multiLineString, point } from '@turf/helpers';

const CONFIDENCE_THRESHOLD = 0.75;
const MAX_SNAP_DISTANCE_METERS = 20;
const MAX_DIRECTION_DELTA = 55;
const CHUNK_SIZE = 90;

export function extractTrackSegments(xmlDocument) {
  const parsePoints = (nodes) => [...nodes].map((node) => ({
    lat: Number(node.getAttribute('lat')),
    lng: Number(node.getAttribute('lon')),
    time: node.querySelector('time')?.textContent || null,
  })).filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng));

  const trackSegments = [...xmlDocument.querySelectorAll('trkseg')].map((segment) => parsePoints(segment.querySelectorAll('trkpt')));
  const routes = [...xmlDocument.querySelectorAll('rte')].map((route) => parsePoints(route.querySelectorAll('rtept')));
  return [...trackSegments, ...routes].filter((segment) => segment.length >= 2);
}

function angleDelta(a, b) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function isReliablePoint(raw, candidate, previousRaw, nextRaw, previousCandidate, nextCandidate, confidence, alternatives) {
  if (!candidate || confidence < CONFIDENCE_THRESHOLD || alternatives > 0) return false;
  const offset = distance(point([raw.lng, raw.lat]), point(candidate), { units: 'meters' });
  if (offset > MAX_SNAP_DISTANCE_METERS) return false;

  if (previousRaw && nextRaw && previousCandidate && nextCandidate) {
    const rawSpan = distance(point([previousRaw.lng, previousRaw.lat]), point([nextRaw.lng, nextRaw.lat]), { units: 'meters' });
    const snappedSpan = distance(point(previousCandidate), point(nextCandidate), { units: 'meters' });
    if (rawSpan > 8) {
      const rawBearing = bearing(point([previousRaw.lng, previousRaw.lat]), point([nextRaw.lng, nextRaw.lat]));
      const snappedBearing = bearing(point(previousCandidate), point(nextCandidate));
      if (angleDelta(rawBearing, snappedBearing) > MAX_DIRECTION_DELTA) return false;
      if (snappedSpan > rawSpan * 3 + 15) return false;
    }
  }
  return true;
}

async function matchChunk(points, endpoint) {
  const coordinates = points.map((item) => `${item.lng},${item.lat}`).join(';');
  const radiuses = points.map(() => MAX_SNAP_DISTANCE_METERS).join(';');
  const url = `${endpoint}/${coordinates}?geometries=geojson&overview=false&steps=false&gaps=split&tidy=true&radiuses=${radiuses}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`道路匹配服务返回 ${response.status}`);
  const data = await response.json();
  if (data.code !== 'Ok' || !Array.isArray(data.tracepoints)) throw new Error(data.message || '没有获得可靠匹配');

  const candidates = data.tracepoints.map((tracepoint) => tracepoint?.location || null);
  return points.map((raw, index) => {
    const tracepoint = data.tracepoints[index];
    const confidence = tracepoint ? (data.matchings?.[tracepoint.matchings_index]?.confidence ?? 0) : 0;
    const reliable = isReliablePoint(
      raw,
      candidates[index],
      points[index - 1],
      points[index + 1],
      candidates[index - 1],
      candidates[index + 1],
      confidence,
      tracepoint?.alternatives_count ?? 1,
    );
    return reliable ? { lat: candidates[index][1], lng: candidates[index][0], snapped: true } : { ...raw, snapped: false };
  });
}

export async function snapSegments(segments, endpoint) {
  const output = [];
  let snappedCount = 0;
  let pointCount = 0;
  for (const segment of segments) {
    const matched = [];
    for (let start = 0; start < segment.length; start += CHUNK_SIZE - 1) {
      const chunk = segment.slice(start, start + CHUNK_SIZE);
      if (chunk.length < 2) break;
      const result = await matchChunk(chunk, endpoint);
      matched.push(...(start === 0 ? result : result.slice(1)));
    }
    snappedCount += matched.filter((item) => item.snapped).length;
    pointCount += matched.length;
    output.push(matched);
  }
  return { segments: output, snappedCount, pointCount };
}

export function createTrackLayer(segments, color) {
  return L.featureGroup(segments.map((segment) => L.polyline(segment.map(({ lat, lng }) => [lat, lng]), {
    color, weight: 5, opacity: 0.88, lineCap: 'round', lineJoin: 'round',
  })));
}

export function createCoverageLayer(segments, radius, color) {
  const coordinates = segments.map((segment) => segment.map(({ lat, lng }) => [lng, lat])).filter((segment) => segment.length >= 2);
  if (!coordinates.length) return L.layerGroup();
  const source = coordinates.length === 1 ? lineString(coordinates[0]) : multiLineString(coordinates);
  const polygon = buffer(source, radius, { units: 'meters', steps: 8 });
  return L.geoJSON(polygon, { style: { color, weight: 1, opacity: 0.28, fillColor: color, fillOpacity: 0.13, interactive: false } });
}
