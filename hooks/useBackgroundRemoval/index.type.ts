import { MutableRefObject } from 'react';

export type BgEffectType = 'image' | 'blur';

export type Props = {
  canvasRef: MutableRefObject<HTMLCanvasElement | null>;
  onApplyBackground: (flag: boolean) => void;
};
