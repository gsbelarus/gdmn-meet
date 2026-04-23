export const DEFAULT_DEVICES_ID = ["default", "communications"];

export const HOME_URL =
  process.env.NEXT_PUBLIC_HOME ?? "http://localhost:3000";

export const PEER_SERVER_URI =
  process.env.NEXT_PUBLIC_WSS_PEER_URI ?? "http://localhost:4000";

export const SOCKET_PATH = process.env.NEXT_PUBLIC_SPACE ?? "/socket.io";

export const OBS_CAMERA_LABEL = "OBS Virtual Camera";

export const CAMERA_FRAME_RATE = 30;
export const FRAME_MS = 1000 / CAMERA_FRAME_RATE;
export const VIDEO_WIDTH_MAX = 320;
export const VIDEO_HEIGHT_MAX = 240;

export const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: VIDEO_WIDTH_MAX },
  height: { ideal: VIDEO_HEIGHT_MAX },
  frameRate: {
    ideal: CAMERA_FRAME_RATE,
    max: CAMERA_FRAME_RATE
  },
  facingMode: "user",
  aspectRatio: { ideal: VIDEO_WIDTH_MAX / VIDEO_HEIGHT_MAX }
};
