declare module 'three/examples/jsm/libs/meshopt_simplifier.module.js' {
  export const MeshoptSimplifier: {
    ready: Promise<void>;
    supported: boolean;
    simplifyWithAttributes(
      indices: Uint32Array, vertexPositions: Float32Array, vertexPositionsStride: number, vertexAttributes: Float32Array,
      vertexAttributesStride: number, attributeWeights: number[], vertexLock: Uint8Array | null, targetIndexCount: number,
      targetError: number, flags?: string[],
    ): [Uint32Array, number];
  };
}
