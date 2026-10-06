// jpeg-js ships no types for its decoder entry point. Importing the decoder
// directly avoids pulling in the encoder, which needs Node's Buffer.
declare module 'jpeg-js/lib/decoder' {
  export default function decode(
    data: Uint8Array | ArrayBuffer,
    opts: { useTArray: true; formatAsRGBA?: boolean; maxResolutionInMP?: number },
  ): { width: number; height: number; data: Uint8Array };
}
