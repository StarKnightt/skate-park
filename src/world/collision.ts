import { BufferGeometry, DoubleSide, Ray, Triangle, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { GrindLine } from './park';

export interface Hit { point: Vector3; normal: Vector3; distance: number; surface: number; faceIndex: number }

const _tri = new Triangle();
const _bary = new Vector3();
const _a = new Vector3(), _b = new Vector3(), _c = new Vector3();
const _na = new Vector3(), _nb = new Vector3(), _nc = new Vector3();

/** Collision world: BVH over the park mesh with smooth (interpolated) normals + grind polylines. */
export class CollisionWorld {
  bvh: MeshBVH;
  private pos: Float32Array;
  private nor: Float32Array;
  private idx: ArrayLike<number>;
  private ray = new Ray();

  constructor(public geometry: BufferGeometry, public surfaces: number[], public grindLines: GrindLine[]) {
    this.bvh = new MeshBVH(geometry, { maxLeafSize: 8 });
    this.pos = geometry.getAttribute('position').array as Float32Array;
    this.nor = geometry.getAttribute('normal').array as Float32Array;
    this.idx = geometry.index!.array;
  }

  private smoothNormal(face: number, p: Vector3, out: Vector3) {
    // BVH may reorder the index buffer; read the triangle from the (possibly re-ordered) index
    const i0 = this.idx[face * 3] * 3, i1 = this.idx[face * 3 + 1] * 3, i2 = this.idx[face * 3 + 2] * 3;
    const P = this.pos, N = this.nor;
    _a.set(P[i0], P[i0 + 1], P[i0 + 2]); _b.set(P[i1], P[i1 + 1], P[i1 + 2]); _c.set(P[i2], P[i2 + 1], P[i2 + 2]);
    _tri.set(_a, _b, _c);
    _tri.getBarycoord(p, _bary);
    _na.set(N[i0], N[i0 + 1], N[i0 + 2]); _nb.set(N[i1], N[i1 + 1], N[i1 + 2]); _nc.set(N[i2], N[i2 + 1], N[i2 + 2]);
    out.set(0, 0, 0).addScaledVector(_na, _bary.x).addScaledVector(_nb, _bary.y).addScaledVector(_nc, _bary.z);
    if (out.lengthSq() < 1e-8) _tri.getNormal(out);
    return out.normalize();
  }

  raycast(origin: Vector3, dir: Vector3, maxDist: number): Hit | null {
    this.ray.origin.copy(origin);
    this.ray.direction.copy(dir);
    const h = this.bvh.raycastFirst(this.ray, DoubleSide, 0, maxDist);
    if (!h || h.distance > maxDist || h.faceIndex === undefined || h.faceIndex === null) return null;
    const n = this.smoothNormal(h.faceIndex, h.point, new Vector3());
    // face the normal against the ray (double sided geometry)
    if (n.dot(dir) > 0) {
      const fn = new Vector3();
      _tri.getNormal(fn);
      if (fn.dot(dir) > 0) n.negate();
    }
    return { point: h.point.clone(), normal: n, distance: h.distance, surface: this.surfaces[this.idx[h.faceIndex * 3]] ?? 0, faceIndex: h.faceIndex };
  }

  closestPoint(p: Vector3, maxDist: number) {
    const target = { point: new Vector3(), distance: 0, faceIndex: 0 };
    const r = this.bvh.closestPointToPoint(p, target as any, 0, maxDist);
    if (!r || target.distance > maxDist) return null;
    return target;
  }
}
