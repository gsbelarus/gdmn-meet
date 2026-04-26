"use client";

import { BanIcon, BlurIcon, Camera, CameraSlash, CancelCallIcon, GhostIcon, LinkIcon, MaskTheaterIcon, Microphone, MicrophoneSlash, ObjectGroupIcon, SquareCaretDownIcon, SquareCaretUpIcon, UserIcon } from '@/components/icons';
import {
  DEFAULT_DEVICES_ID,
  HOME_URL,
  OBS_CAMERA_LABEL,
  PEER_SERVER_URI,
  SOCKET_PATH,
  VIDEO_CONSTRAINTS
} from "@/lib/constants";
import { useBackgroundRemoval } from "@/hooks/useBackgroundRemoval/index";
import { useDetectFaceLandmark } from "@/hooks/useDetectFaceLandmark";
import { useDetectObjects } from "@/hooks/useDetectObjects";
import { useMicVolume } from "@/hooks/useMicVolume";
import { useRuntimeConfig } from '@/hooks/useRuntimeConfig';
import {
  formatToNow,
  useVideoCall
} from "@/hooks/useVideoCall/useVideoCall";
import { Semaphore } from '@/lib/semaphore';
import { MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { v4 } from "uuid";

const MAX_PARTICIPANTS = 6;
const DEFAULT_NAME = 'Your Name';

function generateRandomCode(): string {
  const randomNumber = Math.floor(Math.random() * 1000000);
  const paddedNumber = randomNumber.toString().padStart(6, '0');
  return `${paddedNumber.slice(0, 3)}-${paddedNumber.slice(3)}`;
};
const md2str = (devices: MediaDeviceInfo[]) =>
  devices.map((d) => `${d.deviceId}=${d.label}`).join(",");
const ne = (a: MediaDeviceInfo[], b: MediaDeviceInfo[]) =>
  md2str(a) !== md2str(b);
const has = (devices: MediaDeviceInfo[], deviceId: string) =>
  devices.some((d) => d.deviceId === deviceId);

type NameInputProps = {
  participantName: string;
  setParticipantName: (name: string) => void;
};

function NameInput({ participantName, setParticipantName }: NameInputProps) {
  const [name, setName] = useState(participantName);

  return (
    <input
      className='w-full bg-transparent text-center text-2xl font-semibold text-yellow-50 border-none focus:outline-none sm:text-4xl'
      type='text'
      value={name}
      onChange={e => setName(e.target.value)}
      onBlur={() => setParticipantName(name)}
      autoFocus
    />
  );
};

type VideoAvatarProps = {
  participantName: string;
};

function VideoAvatar({ participantName }: VideoAvatarProps) {
  const initials = participantName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className='w-24 h-24 flex flex-col justify-center items-center rounded-full bg-zinc-500 text-yellow-100 text-3xl font-semibold'>
      {initials}
    </div>
  );
};

type ButtonProps = {
  disabled?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
};

function Button({ disabled, children, onClick }: ButtonProps) {
  const [pressed, setPressed] = useState(false);
  const [activated, setActivated] = useState(false);

  useEffect(() => {
    if (pressed) {
      let timeout = setTimeout(() => {
        setPressed(false);
        setActivated(true);
      }, 200);
      return () => clearTimeout(timeout);
    }
  }, [pressed]);

  useEffect(() => {
    if (activated) {
      let timeout = setTimeout(() => {
        setActivated(false);
        onClick?.();
      }, 80);
      return () => clearTimeout(timeout);
    }
  }, [activated, onClick]);

  return (
    <div className='relative w-64 h-16'>
      {
        pressed ?
          <div
            className='relative w-64 h-14 left-1 top-1 flex flex-row justify-center items-center gap-4 font-semibold text-2xl bg-orange-700 hover:bg-orange-600 text-yellow-100 hover:text-yellow-50 cursor-pointer rounded-lg border border-solid border-orange-950 z-10'
            onClick={onClick}
          >
            {children}
          </div>
          :
          <>
            <div
              className={`relative w-64 h-14 flex flex-row justify-center items-center gap-4 font-semibold text-2xl bg-orange-700 ${disabled ? 'text-orange-500 cursor-default' : 'text-yellow-100 hover:text-yellow-50 hover:bg-orange-600 cursor-pointer'} rounded-lg border border-solid border-orange-950 z-10`}
              onClick={disabled ? undefined : () => setPressed(true)}
            >
              {children}
            </div>
            <div
              className='relative left-1 bottom-[3.2rem] w-64 h-14 bg-yellow-200 rounded-lg'
            >
              &nbsp;
            </div>
          </>
      }
    </div>
  );
};

type Effects = 'none' | 'background' | 'objects' | 'face' | 'face-mask';
const effectsList: Effects[] = ['none', 'background', 'objects', 'face', 'face-mask'];

type EffectIconProps = {
  effect: Effects;
  selected: boolean;
  onClick?: () => void;
};

function EffectIcon({ effect, selected, onClick }: EffectIconProps) {
  const props = {
    className: `w-6 h-6 ${selected ? 'text-red-400' : 'text-white'} hover:text-yellow-100 cursor-pointer tab-focusable pointer-events-auto`,
    onClick
  };

  return (
    <div
      className='relative w-6 h-6 flex flex-col justify-center items-center cursor-pointer'
    >
      {
        effect === 'background'
          ? <BlurIcon {...props} />
          : effect === 'objects'
            ? <ObjectGroupIcon {...props} />
            : effect === 'face'
              ? <GhostIcon {...props} />
              : effect === 'face-mask'
                ? <MaskTheaterIcon {...props} />
                : <BanIcon {...props} />
      }
    </div>
  );
};

type VolumeFrameProps = {
  mediaStream: MediaStream | null | undefined;
};

function VolumeFrame({ mediaStream }: VolumeFrameProps) {
  const { micVolume } = useMicVolume({ mediaStream });
  return (
    <div
      className={`absolute inset-0 border-solid ${micVolume < 15 ? 'border-2 border-orange-800' : 'border-[4px] border-red-500'} rounded-lg z-20`}
    />
  );
};

type VideoProps = {
  width: number | string;
  height: number | string;
  pId: string;
  participantName?: string;
  mediaStream?: MediaStream | null;
  mediaError?: boolean;
  problemDiscovered?: number;
  controls?: boolean;
  audioEnabled?: boolean;
  videoEnabled?: boolean;
  dontShowLoader?: boolean;
  effects?: Effects;
  videoDevices?: MediaDeviceInfo[];
  audioDevices?: MediaDeviceInfo[];
  currentCamera?: string;
  currentMicrophone?: string;
  applyingEffects?: Effects;
  onMountCallBack?: (element: HTMLVideoElement) => void;
  onVideoReadyStateChange?: (pId: string, state: number | undefined) => void;
  onMicSwitched?: (enabled: boolean) => void;
  onCamSwitched?: (enabled: boolean) => void;
  onCamSelected?: (deviceId: string) => void;
  onMicSelected?: (deviceId: string) => void;
  setEffects?: (effects: Effects) => void;
};

function Video({
  width,
  height,
  pId,
  participantName,
  mediaStream,
  mediaError,
  problemDiscovered,
  controls,
  audioEnabled,
  videoEnabled,
  dontShowLoader,
  effects,
  videoDevices,
  audioDevices,
  currentCamera,
  currentMicrophone,
  applyingEffects,
  onMountCallBack,
  onVideoReadyStateChange,
  onMicSwitched,
  onCamSwitched,
  onCamSelected,
  onMicSelected,
  setEffects
}: VideoProps) {
  const [selector, setSelector] = useState<'effect' | 'camera' | 'microphone' | 'none'>('none');
  const ownRef = useRef<HTMLVideoElement | null>(null);

  const ownVideo = participantName === undefined;

  useEffect(() => {
    // here we are counting on the fact that the ref is set before useEffect is called
    if (ownRef.current) {
      if (mediaStream && ownRef.current.srcObject !== mediaStream) {
        console.log('set video stream...');
        ownRef.current.srcObject = mediaStream;
      }
      onMountCallBack?.(ownRef.current);
    }
  }, [mediaStream, onMountCallBack]);

  const updateReadyState = useCallback(() => {
    ownRef.current && onVideoReadyStateChange?.(pId, ownRef.current.readyState);
  }, [pId, onVideoReadyStateChange]);

  const isAudioEnabled = (audioEnabled ?? true) && mediaStream?.getAudioTracks().some(track => track.enabled);
  const isVideoEnabled = (videoEnabled ?? true) && mediaStream?.getVideoTracks().some(track => track.enabled);
  const hasStream = mediaStream && mediaStream.active && mediaStream.getVideoTracks().length && mediaStream.getAudioTracks().length;
  const loader = !hasStream && !mediaError && !dontShowLoader;

  const handleMicOff = useCallback(() => {
    onMicSwitched?.(false);
    setSelector('none');
  }, [onMicSwitched]);

  const handleMicOn = useCallback(() => {
    onMicSwitched?.(true);
    setSelector('none');
  }, [onMicSwitched]);

  const handleSelectMicOn = useCallback(() => {
    setSelector('microphone');
  }, []);

  const handleSelectMicOff = useCallback(() => {
    setSelector('none');
  }, []);

  return (
    <div
      className='relative rounded-lg overflow-hidden bg-zinc-600'
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
      }}
    >
      {
        loader
        &&
        <div className='absolute inset-0 flex flex-col items-center justify-center z-50'>
          <div className="loader drop-shadow-md"></div>
        </div>
      }
      {
        ownVideo && applyingEffects && applyingEffects !== 'none'
          ?
          <div className='absolute inset-0 flex flex-col items-center justify-center gap-10
           z-50'>
            <div className='text-3xl font-medium text-yellow-100'>
              {
                applyingEffects === 'background'
                  ? 'Removing the background...'
                  : applyingEffects === 'objects'
                    ? 'Detecting objects...'
                    : applyingEffects === 'face' || applyingEffects === 'face-mask'
                      ? 'Detecting face landmarks...'
                      : 'Applying effect...'
              }
            </div>
            <div className="loader drop-shadow-md"></div>
          </div>
          :
          null
      }
      {
        <video
          className='w-full h-full object-cover'
          autoPlay
          playsInline
          ref={ownRef}
          muted={pId === "local"}
          onLoadStart={updateReadyState}
          onCanPlay={updateReadyState}
          onCanPlayThrough={updateReadyState}
          onProgress={updateReadyState}
          onStalled={updateReadyState}
          onSuspend={updateReadyState}
          onWaiting={updateReadyState}
        />
      }
      {
        mediaError
        &&
        <div className='absolute inset-0 flex flex-col items-center justify-center z-50'>
          Something is wrong! <br /> Please check your camera and microphone.
        </div>
      }
      {
        mediaStream
        && !isVideoEnabled
        &&
        <div className='absolute inset-0 bg-zinc-600 z-10' />
      }
      {
        mediaStream
        && (!isAudioEnabled || !isVideoEnabled)
        && ((ownVideo && applyingEffects === 'none') || !ownVideo)
        &&
        <div className='absolute inset-0 bg-black/30 flex flex-col items-center justify-center gap-4 z-10'>
          {
            !isAudioEnabled && !controls && (!participantName || participantName === DEFAULT_NAME) &&
            <MicrophoneSlash
              className='text-yellow-100'
              size={84}
            />
          }
          {
            isVideoEnabled
              ?
              null
              : participantName && participantName !== DEFAULT_NAME
                ?
                <VideoAvatar participantName={participantName} />
                :
                !controls && <CameraSlash
                  className='text-yellow-100'
                  size={84}
                />

          }
        </div>
      }
      {
        !ownVideo && participantName && participantName !== DEFAULT_NAME &&
        <div className='absolute top-4 right-4 px-2 py-1 flex flex-row justify-start items-center gap-2 z-20 bg-yellow-100/80 rounded shadow text-zinc-900 text-sm font-medium border border-solid border-orange-900'>
          {isAudioEnabled ? '' : <MicrophoneSlash className='text-red-700' size={16} />} {participantName}
        </div>
      }
      {
        problemDiscovered ? (
          <div className='absolute inset-0 bg-black/50 flex flex-col items-center justify-center z-20 text-yellow-100 text-lg font-semibold'>
            {
              Date.now() - problemDiscovered < 4_000
                ?
                <div>
                  Unstable connection...
                </div>
                :
                <>
                  <div>Connection lost</div>
                  <div>
                    {`Reconnecting... ${formatToNow(problemDiscovered)}...`}
                  </div>
                </>
            }
          </div>
        ) : null
      }
      <div className='absolute w-full h-12 bottom-4 flex flex-row justify-around items-end z-40'>
        {
          controls && mediaStream ?
            <div className='relative w-28 h-12'>
              <div
                className={`cursor-pointer w-28 h-12 flex flex-row justify-center items-center gap-4 ${isAudioEnabled ? 'bg-black/50' : 'bg-red-700/90'} rounded-full`}
              >
                {
                  isAudioEnabled ?
                    <Microphone
                      className='text-white'
                      onClick={handleMicOff}
                    />
                    :
                    <MicrophoneSlash
                      className='text-white animate-pulse'
                      onClick={handleMicOn}
                    />
                }
                {
                  selector === 'microphone' ?
                    <SquareCaretDownIcon
                      className='text-white'
                      onClick={handleSelectMicOff}
                    />
                    :
                    <SquareCaretUpIcon
                      className='text-white'
                      onClick={handleSelectMicOn}
                    />
                }
              </div>
              {
                selector === 'microphone' ?
                  <div
                    className='absolute left-0 bottom-14 p-4 flex flex-col justify-start items-start gap-2 border border-solid border-yellow-100 bg-orange-900/90 rounded shadow cursor-pointer'
                  >
                    {
                      audioDevices?.map((device) => (
                        <div
                          key={device.deviceId}
                          className='flex flex-row justify-start items-center gap-2 text-zinc-100 text-lg font-medium hover:text-yellow-100'
                          onClick={currentMicrophone === device.deviceId ?
                            handleSelectMicOff
                            :
                            () => {
                              setSelector('none');
                              onMicSelected?.(device.deviceId);
                            }
                          }
                        >
                          <div>
                            {
                              currentMicrophone === device.deviceId ? '☑' : '☐'
                            }
                          </div>
                          <div
                            className='text-nowrap'
                          >
                            {device.label || device.deviceId}
                          </div>
                        </div>
                      ))
                    }
                  </div>
                  :
                  null
              }
            </div>
            :
            null
        }
        {
          controls && mediaStream ?
            <div className='relative w-28 h-12'>
              <div
                className={`cursor-pointer w-28 h-12 flex flex-row justify-center items-center gap-4 ${isVideoEnabled ? 'bg-black/50' : 'bg-red-700/90'} rounded-full`}
              >
                {
                  isVideoEnabled ?
                    <Camera
                      className='text-white'
                      onClick={
                        () => {
                          onCamSwitched?.(false);
                          setSelector('none');
                        }
                      }
                    />
                    :
                    <CameraSlash
                      className='text-white animate-pulse'
                      onClick={
                        () => {
                          onCamSwitched?.(true);
                          setSelector('none');
                        }
                      }
                    />
                }
                {
                  selector === 'camera' ?
                    <SquareCaretDownIcon
                      className='text-white'
                      onClick={() => setSelector('none')}
                    />
                    :
                    <SquareCaretUpIcon
                      className='text-white'
                      onClick={() => setSelector('camera')}
                    />
                }
              </div>
              {
                selector === 'camera' ?
                  <div
                    className='absolute left-0 bottom-14 p-4 flex flex-col justify-start items-start gap-2 border border-solid border-yellow-100 bg-orange-900/90 rounded shadow cursor-pointer'
                  >
                    {
                      videoDevices?.map((device) => (
                        <div
                          key={device.deviceId}
                          className='flex flex-row justify-start items-center gap-2 text-zinc-100 text-lg font-medium hover:text-yellow-100'
                          onClick={currentCamera === device.deviceId ?
                            () => {
                              setSelector('none');
                            }
                            :
                            () => {
                              setSelector('none');
                              setEffects?.('none');
                              onCamSelected?.(device.deviceId);
                            }
                          }
                        >
                          <div>
                            {
                              currentCamera === device.deviceId ? '☑' : '☐'
                            }
                          </div>
                          <div
                            className='text-nowrap'
                          >
                            {device.label || device.deviceId}
                          </div>
                        </div>
                      ))
                    }
                  </div>
                  :
                  null
              }
            </div>
            :
            null
        }
        {
          (controls && effects && mediaStream) ?
            selector === 'effect' ?
              <div
                className={`w-12 h-60 py-3 flex flex-col justify-between items-center gap-4 ${isVideoEnabled ? 'cursor-pointer bg-black/50' : 'cursor-default bg-black/25'} rounded-full`}
              >
                {
                  effectsList
                    .filter(effect => effect !== effects)
                    .map((effect) => (
                      <EffectIcon
                        key={effect}
                        effect={effect}
                        selected={effects === effect}
                        onClick={() => {
                          setEffects?.(effect);
                          setSelector('none');
                        }}
                      />
                    ))
                    .concat(
                      <EffectIcon
                        key='selected-effect'
                        effect={effects}
                        selected={false}
                        onClick={() => {
                          setSelector('none');
                        }}
                      />
                    )
                }
              </div>
              :
              <div className={`cursor-pointer w-12 h-12 flex flex-col justify-center items-center ${isVideoEnabled && mediaStream ? 'bg-black/50' : 'bg-red-700/90'} rounded-full`}
                onClick={isVideoEnabled && mediaStream ? () => setSelector('effect') : undefined}>
                <EffectIcon
                  effect={effects}
                  selected={false}
                  onClick={isVideoEnabled && mediaStream ? () => setSelector('effect') : undefined}
                />
              </div>
            :
            null
        }
      </div>
      <VolumeFrame mediaStream={mediaStream} />
    </div>
  );
};

type Mode = 'master' | 'participant';

type VideoCallProps = {
  enterByRoomId?: string;
  onCallEnd: () => void;
};

function VideoCall({ enterByRoomId, onCallEnd }: VideoCallProps) {
  const [participantId] = useState(v4());
  const [mode, setMode] = useState<Mode>(enterByRoomId ? 'participant' : 'master');
  const [checkForMaster, setCheckForMaster] = useState(false);
  const [roomId, setRoomId] = useState(enterByRoomId || generateRandomCode());
  const { config: runtimeConfig } = useRuntimeConfig();
  const ownRef = useRef<HTMLVideoElement | null>(null);
  const semaphoreRef = useRef(new Semaphore(1));
  const [_redrawCounter, setRedrawCounter] = useState(0);
  const fetchDevicesSemaphoreRef = useRef(new Semaphore(1));
  const stopMediaStreamRef = useRef<() => void>(() => { });
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [currentCamera, setCurrentCamera] = useState<string | undefined>();
  const [currentMicrophone, setCurrentMicrophone] = useState<
    string | undefined
  >();
  const homeUrl = runtimeConfig?.homeUrl ?? '';
  const peerServerUrl = runtimeConfig?.peerServerUrl ?? '';
  const socketPath = runtimeConfig?.socketPath ?? SOCKET_PATH;
  const {
    participantName,
    participantState,
    setParticipantName: setCallParticipantName,
    setParticipantState,
    localStream,
    setLocalStream,
    enableTrack,
    setVideoReadyState,
    participants,
    makeCall,
    endCall,
    switchTrack,
    error: callError,
    configError,
    configLoading,
  } = useVideoCall<'ready-to-go' | 'master', string>({
    homeUrl,
    peerServerUrl,
    socketPath,
    roomId: roomId || 'default*&!@',
    participantId,
    participantName: DEFAULT_NAME,
  });
  const [effects, setEffects] = useState<Effects>('none');
  const [applyingEffects, setApplyingEffects] = useState<Effects>('none');
  const [callHasStarted, setCallHasStarted] = useState(false);
  const [thereWasMaster, setThereWasMaster] = useState(false);
  const [cameraWasNotReadable, setCameraWasNotReadable] = useState(false);

  const endTheCall = useCallback(() => {
    for (const p of participants) {
      if (p.state === 'in-call') {
        endCall(p);
      }
    }
    onCallEnd();
  }, [onCallEnd, participants, endCall]);

  useEffect(() => {
    let timeout: NodeJS.Timeout | undefined = undefined;

    if (mode === 'master') {
      setParticipantState('master');
    }

    if (mode === 'participant') {
      timeout = setTimeout(() => {
        setCheckForMaster(true);
      }, 2000);
    }

    return () => {
      if (timeout) {
        clearTimeout(timeout);
      }
    };
  }, [mode, setParticipantState]);

  useEffect(() => {
    if (checkForMaster) {
      if (mode === 'participant' && participantState !== 'ready-to-go') {
        if (!participants.some(p => p.participantState === 'master')) {
          setMode('master');
          setParticipantState('master');
        }
      }
      setCheckForMaster(false);
    }
  }, [checkForMaster, participants, participantState, mode, setParticipantState]);

  useEffect(() => {
    const inCall = participants.some(p => p.state === 'in-call');

    if (inCall && !callHasStarted) {
      setCallHasStarted(true);
      return;
    }

    if (!inCall && callHasStarted) {
      onCallEnd();
    }
  }, [participants, callHasStarted, onCallEnd]);

  useEffect(() => {
    if (mode === 'participant') {
      if (!thereWasMaster && participants.some(p => p.participantState === 'master')) {
        setThereWasMaster(true);
        return;
      }

      if (thereWasMaster && !participants.some(p => p.participantState === 'master')) {
        onCallEnd();
        return;
      }
    }
  }, [participants, thereWasMaster, onCallEnd, mode]);

  const onApplyBackground = useCallback((flag: boolean) => setEffects(flag ? 'background' : 'none'), []);

  // Background
  const backgroundCanvasRef = useRef<HTMLCanvasElement>(null);
  const { applyBackgroundRemoval, clearBackgroundRemoval } = useBackgroundRemoval({
    canvasRef: backgroundCanvasRef,
    onApplyBackground
  });

  // Objects detection
  const objectsDetectionCanvasRef = useRef<HTMLCanvasElement>(null);
  const {
    startDetection: startObjectsDetection,
    stopDetection: stopObjectsDetection
  } = useDetectObjects({
    canvasRef: objectsDetectionCanvasRef,
  });

  // Face landmark detection
  const faceLandmarkDetectionCanvasRef = useRef<HTMLCanvasElement>(null);
  const {
    startDetection: startFaceLandmarkDetection,
    stopDetection: stopFacelandmarkDetection
  } = useDetectFaceLandmark({
    canvasRef: faceLandmarkDetectionCanvasRef
  });

  const redraw = useCallback(() => setRedrawCounter((prev) => prev + 1), []);

  const run = useCallback(async function run<R>(
    semaphore: MutableRefObject<Semaphore>,
    fn: () => R,
  ): Promise<R> {
    await semaphore.current.acquire();
    try {
      return await fn();
    } finally {
      semaphore.current.release();
      redraw();
    }
  }, [redraw]);

  const cameraWidth = 320;
  const cameraHeight = 240;

  const videoConstraints: MediaTrackConstraints = useMemo(() => ({
    ...VIDEO_CONSTRAINTS,
    width: {
      ideal: cameraWidth,
    },
    height: {
      ideal: cameraHeight,
    },
  }), [cameraWidth, cameraHeight]);

  const stopTrack = useCallback((track: MediaStreamTrack) => {
    track.removeEventListener("ended", redraw);
    track.removeEventListener("mute", redraw);
    track.removeEventListener("unmute", redraw);
    track.stop();
  }, [redraw]);

  const fetchDevices = useCallback(async () => {
    run(fetchDevicesSemaphoreRef, async () => {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const newVideoDevices = devices.filter(
        (device) =>
          device.kind === "videoinput" &&
          device.label !== OBS_CAMERA_LABEL &&
          !DEFAULT_DEVICES_ID.includes(device.deviceId),
      );
      const newAudioDevices = devices.filter(
        (device) =>
          device.kind === "audioinput" &&
          !DEFAULT_DEVICES_ID.includes(device.deviceId),
      );

      setVideoDevices((prev) =>
        ne(newVideoDevices, prev) ? newVideoDevices : prev,
      );
      setAudioDevices((prev) =>
        ne(newAudioDevices, prev) ? newAudioDevices : prev,
      );

      console.log("fetched video devices: ", newVideoDevices);
      console.log("fetched audio devices: ", newAudioDevices);
    });
  }, [run]);

  useEffect(() => {
    async function fn() {
      await fetchDevices();
      navigator.mediaDevices.ondevicechange = fetchDevices;
    };

    fn();

    return () => {
      navigator.mediaDevices.ondevicechange = null;
      stopMediaStreamRef.current();
    };
  }, [fetchDevices]);

  const getMedia = useCallback(async (cameraId?: string, microphoneId?: string) => {
    if (!ownRef.current) {
      return;
    }

    if (!videoDevices.length || !audioDevices.length) {
      return;
    }

    try {
      await run(semaphoreRef, async () => {
        stopMediaStreamRef.current();

        let selectedCameraId = cameraId && videoDevices.find((el) => el.deviceId === cameraId)?.deviceId; //?? videoDevices[0].deviceId;
        let selectedMicrophoneId = microphoneId && audioDevices.find((el) => el.deviceId === microphoneId)?.deviceId; // ?? audioDevices[0].deviceId;
        let cameraProbeIdx = 0;

        let newStream: MediaStream | null = null;

        console.log('videoDevices ', videoDevices.map((d) => d.deviceId));
        console.log('audioDevices ', audioDevices.map((d) => d.deviceId));

        while (!newStream) {
          try {
            console.log('try camera --> ', selectedCameraId);
            console.log('try microphone --> ', selectedMicrophoneId);

            newStream = await navigator.mediaDevices.getUserMedia({
              video: selectedCameraId
                ?
                {
                  deviceId: { exact: selectedCameraId },
                  ...videoConstraints,
                }
                :
                {
                  ...videoConstraints,
                },
              audio: selectedMicrophoneId
                ?
                {
                  deviceId: { exact: selectedMicrophoneId },
                  echoCancellation: false,
                  noiseSuppression: false,
                  autoGainControl: false,
                }
                :
                {
                  echoCancellation: false,
                  noiseSuppression: false,
                  autoGainControl: false,
                },
            });
          } catch (e: any) {
            if (e.name === 'NotReadableError') {
              if (cameraProbeIdx < videoDevices.length) {
                console.log('camera is taken by another process --> ', selectedCameraId);
                selectedCameraId = videoDevices[cameraProbeIdx++].deviceId;
              } else {
                setCameraWasNotReadable(true);
                throw e;
              }
            } else {
              throw e;
            }
          }
        }

        if (newStream) {
          newStream.getTracks().forEach((track) => {
            track.addEventListener("ended", redraw);
            track.addEventListener("mute", redraw);
            track.addEventListener("unmute", redraw);
          });

          ownRef.current!.srcObject = newStream;

          await fetchDevices(); // need of firefox to update device labels

          if (!selectedCameraId) {
            const videoTracks = newStream.getVideoTracks();

            if (videoTracks.length > 0) {
              selectedCameraId = videoTracks[0].getSettings().deviceId ?? '';
            }
          }

          console.log('selectedCameraId ', selectedCameraId);
          setCurrentCamera(selectedCameraId);

          if (!selectedMicrophoneId) {
            const audioTracks = newStream.getAudioTracks();

            if (audioTracks.length > 0) {
              selectedMicrophoneId = audioTracks[0].getSettings().deviceId ?? '';
            }
          }

          console.log('selectedMicrophoneId ', selectedMicrophoneId);
          setCurrentMicrophone(selectedMicrophoneId);

          setEffects('none');
          setLocalStream(newStream);
          setCameraWasNotReadable(false);
        }
      });
    } catch (e) {
      console.error(e);

      // on firefox we need to update the list of devices
      await fetchDevices();
    }
  }, [videoDevices, audioDevices, videoConstraints, run, redraw, fetchDevices, setLocalStream]);

  useEffect(() => {
    if (videoDevices.length && audioDevices.length) {
      if (!currentCamera && !currentMicrophone) {
        getMedia();
      }
    }
  }, [videoDevices, audioDevices, currentCamera, currentMicrophone, getMedia]);

  const switchDevicesRef = useRef<(newCameraId: string | undefined, newMicrophoneId: string | undefined) => Promise<void>>(async () => { });

  switchDevicesRef.current = async (
    newCameraId: string | undefined,
    newMicrophoneId: string | undefined,
  ) => {
    if (!localStream) {
      return;
    }

    if (!newCameraId && !newMicrophoneId) {
      return;
    }

    console.log("switch 1...");

    try {
      console.log("switch 2...");

      await run(semaphoreRef, async () => {
        const newStream = await navigator.mediaDevices.getUserMedia({
          video: newCameraId
            ?
            {
              deviceId: { exact: newCameraId },
              ...videoConstraints,
            }
            :
            {
              ...videoConstraints,
            },
          audio: newMicrophoneId
            ?
            {
              deviceId: { exact: newMicrophoneId },
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            }
            :
            {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
        });

        if (effects === 'background') {
          clearBackgroundRemoval();
          await applyBackgroundRemoval(newStream);
        }

        if (effects === 'objects') {
          stopObjectsDetection();
          await startObjectsDetection(newStream);
        }

        if (effects === 'face') {
          stopFacelandmarkDetection();
          await startFaceLandmarkDetection(newStream, false);
        }

        if (effects === 'face-mask') {
          stopFacelandmarkDetection();
          await startFaceLandmarkDetection(newStream, true);
        }

        console.log("switch 3...");

        if (newCameraId) {
          const newVideoTrack = newStream.getVideoTracks()[0];

          if (newVideoTrack) {
            console.log("switch 4/v...");

            let prevVideoDisabled = false;

            while (localStream.getVideoTracks().length) {
              const track = localStream.getVideoTracks()[0];
              if (!track.enabled) {
                prevVideoDisabled = true;
              }
              stopTrack(track);
              localStream.removeTrack(track);
            }

            if (prevVideoDisabled) {
              newVideoTrack.enabled = false;
            }

            localStream.addTrack(newVideoTrack);

            switchTrack("video", localStream);
            setCurrentCamera(newCameraId);

            console.log("switch 5/v...");
          }
        }

        if (newMicrophoneId) {
          const newAudioTrack = newStream.getAudioTracks()[0];

          if (newAudioTrack) {
            console.log("switch 4/a...");

            let prevAudioDisabled = false;

            while (localStream.getAudioTracks().length) {
              const track = localStream.getAudioTracks()[0];
              if (!track.enabled) {
                prevAudioDisabled = true;
              }
              stopTrack(track);
              localStream.removeTrack(track);
            }

            if (prevAudioDisabled) {
              newAudioTrack.enabled = false;
            }

            localStream.addTrack(newAudioTrack);

            switchTrack("audio", localStream);
            setCurrentMicrophone(newMicrophoneId);

            console.log("switch 5/a...");
          }
        }
      });

      await fetchDevices(); // need of firefox to update device labels
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    // when usb device gets disconnected, there would be several successive events
    // we let them all settle and update the devices list appropriately
    // only after that we check if the current device is still available
    const timeout = setTimeout(async () => {
      if (localStream) {
        let newCameraId = undefined;
        let newMicrophoneId = undefined;

        // console.log("currentCamera", currentCamera);
        // console.log("currentMicrophone", currentMicrophone);
        // console.log("currentMicrophone", currentMicrophone);
        // console.log("videoDevices", videoDevices);
        // console.log("audioDevices", audioDevices);

        if (currentCamera && videoDevices.length) {
          if (!has(videoDevices, currentCamera)) {
            console.log("useEffect --> switchCamera...");
            newCameraId = videoDevices[0].deviceId;
          }
        }

        if (currentMicrophone && audioDevices.length) {
          if (!has(audioDevices, currentMicrophone)) {
            console.log("useEffect --> switchMicrophone...");
            newMicrophoneId = audioDevices[0].deviceId;
          }
        }

        if (newCameraId || newMicrophoneId) {
          await switchDevicesRef.current(newCameraId, newMicrophoneId);
        }
      }
    }, 1_000);
    return () => clearTimeout(timeout);
  }, [
    localStream,
    currentCamera,
    currentMicrophone,
    videoDevices,
    audioDevices,
  ]);

  stopMediaStreamRef.current = () => {
    if (localStream) {
      localStream.getTracks().forEach(stopTrack);
      ownRef.current!.srcObject = null;
      setLocalStream(null);
      setEffects('none');

      clearBackgroundRemoval();
      stopObjectsDetection();
      stopFacelandmarkDetection();
    }
  };

  const handleCameraChange = useCallback(async (newCamera: string) => {
    if (newCamera !== currentCamera) {
      if (localStream) {
        switchDevicesRef.current(newCamera, currentMicrophone);
      } else {
        if (cameraWasNotReadable) {
          try {
            await getMedia(newCamera, currentMicrophone);
          }
          catch (e) {
            console.warn(e);
            setCurrentCamera(newCamera);
          }
        } else {
          setCurrentCamera(newCamera);
        }
      }
    }
  }, [localStream, currentMicrophone, currentCamera, cameraWasNotReadable, getMedia]);

  const handleMicChange = useCallback(async (newMicrophone: string) => {
    if (newMicrophone !== currentMicrophone) {
      if (localStream) {
        switchDevicesRef.current(currentCamera, newMicrophone);
      } else {
        setCurrentMicrophone(newMicrophone);
      }
    }
  }, [localStream, currentMicrophone, currentCamera]);

  const onLocalMountCallback = useCallback((element: HTMLVideoElement) => {
    ownRef.current = element;
  }, []);

  const offEffect = useCallback(async (offFunction: () => void) => {
    if (!localStream) {
      return;
    }

    // get new video without effect
    await run(semaphoreRef, async () => {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: currentCamera
          ?
          {
            deviceId: { exact: currentCamera },
            ...videoConstraints,
          }
          :
          {
            ...videoConstraints,
          },
        audio: false,
      });

      const newVideoTrack = newStream.getVideoTracks()[0];

      if (newVideoTrack) {
        let prevVideoDisabled = false;

        while (localStream.getVideoTracks().length) {
          const track = localStream.getVideoTracks()[0];
          if (!track.enabled) {
            prevVideoDisabled = true;
          }
          stopTrack(track);
          localStream.removeTrack(track);
        }

        if (prevVideoDisabled) {
          newVideoTrack.enabled = false;
        }

        localStream.addTrack(newVideoTrack);

        newStream.removeTrack(newVideoTrack);
        offFunction();
        setEffects('none');
      }

      newStream.getTracks().forEach(stopTrack);
    });

    switchTrack("video", localStream);
  }, [localStream, switchTrack, currentCamera, videoConstraints, run, stopTrack]);

  const onEffect = useCallback(async (effect: Effects, onFunction: (s: MediaStream) => Promise<void | MediaStream>) => {
    if (!localStream) {
      return;
    }

    setApplyingEffects(effect);
    try {
      await onFunction(localStream);
      setEffects(effect);
    }
    finally {
      setApplyingEffects('none');
    }

    switchTrack("video", localStream);
  }, [localStream, switchTrack]);

  const inCall = participants.filter(
    p =>
      (p.state === 'in-call' || p.state === 'calling')
      ||
      (mode === 'master' && p.state === 'ready' && p.participantState === 'ready-to-go')
  );
  const tileFrameClassName = 'relative mx-auto aspect-[4/3] w-full min-w-0 max-w-[40rem] overflow-hidden rounded-lg';
  const tileShadow = '4px 4px 0px 0px yellow';

  const setEffectsHandler = useCallback(async (newEffects: Effects) => {
    if (effects === 'background' && newEffects !== 'background') {
      await offEffect(clearBackgroundRemoval);
    }

    if (effects === 'objects' && newEffects !== 'objects') {
      await offEffect(stopObjectsDetection);
    }

    if (effects === 'face' && newEffects !== 'face') {
      await offEffect(stopFacelandmarkDetection);
    }

    if (effects === 'face-mask' && newEffects !== 'face-mask') {
      await offEffect(stopFacelandmarkDetection);
    }

    if (newEffects === 'background' && effects !== 'background') {
      await onEffect('background', applyBackgroundRemoval);
    }

    if (newEffects === 'objects' && effects !== 'objects') {
      await onEffect('objects', startObjectsDetection);
    }

    if (newEffects === 'face' && effects !== 'face') {
      await onEffect('face', async (s) => {
        await startFaceLandmarkDetection(s, false);
      });
    }

    if (newEffects === 'face-mask' && effects !== 'face-mask') {
      await onEffect('face-mask', async (s) => {
        await startFaceLandmarkDetection(s, true);
      });
    }
  }, [
    effects, onEffect, offEffect, clearBackgroundRemoval, stopObjectsDetection, stopFacelandmarkDetection,
    applyBackgroundRemoval, startObjectsDetection, startFaceLandmarkDetection
  ]);

  const OwnVideo = useCallback(() =>
    <div
      className={`${tileFrameClassName} bg-none`}
      style={{
        boxShadow: tileShadow,
      }}
    >
      <Video
        width='100%'
        height='100%'
        pId="local"
        mediaStream={localStream}
        dontShowLoader={localStream === null}
        controls={applyingEffects === 'none'}
        onMountCallBack={onLocalMountCallback}
        onMicSwitched={(enabled) => {
          enableTrack("audio", enabled);
          redraw();
        }}
        onCamSwitched={(enabled) => {
          enableTrack("video", enabled);
          redraw();
        }}
        onMicSelected={handleMicChange}
        onCamSelected={handleCameraChange}
        effects={effects}
        videoDevices={videoDevices}
        audioDevices={audioDevices}
        currentCamera={currentCamera}
        currentMicrophone={currentMicrophone}
        applyingEffects={applyingEffects}
        setEffects={setEffectsHandler}
      />
      <canvas
        ref={backgroundCanvasRef}
        className='block absolute inset-0 invisible'
      />
      <canvas
        ref={objectsDetectionCanvasRef}
        className='block absolute inset-0 invisible'
      />
      <canvas
        ref={faceLandmarkDetectionCanvasRef}
        className='block absolute inset-0 invisible'
      />
      {
        localStream
          ?
          null
          :
          <div className='absolute inset-0 px-4 flex flex-col items-center justify-center gap-12 bg-zinc-600 font-semibold text-yellow-50 z-20'>
            <div className='text-3xl text-center animate-pulse'>
              Please allow access to your
              <br />
              camera and microphone...
            </div>
            <div className='text-2xl text-center'>
              if not working, other applications
              <br />
              may be using them...
            </div>
          </div>
      }
    </div>,
    [
      tileFrameClassName, tileShadow, localStream, onLocalMountCallback, enableTrack, redraw, handleMicChange, handleCameraChange,
      effects, videoDevices, audioDevices, currentCamera, currentMicrophone, setEffectsHandler, applyingEffects
    ]);

  const TheirVideo = useCallback(({ p }: { p: typeof inCall[number]; }) => {
    const { id, name, stream, problemDiscovered, audioEnabled, videoEnabled } = p;

    return (
      <div
        className={`${tileFrameClassName} bg-none`}
        style={{
          boxShadow: tileShadow,
        }}
      >
        <Video
          width='100%'
          height='100%'
          pId={id}
          participantName={name}
          mediaStream={stream}
          problemDiscovered={problemDiscovered}
          audioEnabled={audioEnabled}
          videoEnabled={videoEnabled}
          onVideoReadyStateChange={setVideoReadyState}
        />
      </div>
    );
  }, [tileFrameClassName, tileShadow, setVideoReadyState]);

  const components = useMemo(() => {
    const setupError = callError || configError;
    const res = [
      <div key='1' className='relative'>
        <OwnVideo />
        {
          localStream && applyingEffects === 'none' && !participants.find(p => p.state === 'in-call') &&
          <div
            className='absolute w-full px-4 h-16 bottom-20 z-30 flex flex-row justify-center'
          >
            <NameInput
              participantName={participantName}
              setParticipantName={setCallParticipantName}
            />
          </div>
        }
      </div>
    ];

    for (const p of participants) {
      if (p.state === 'in-call') {
        res.push(<TheirVideo key={p.id} p={p} />);
      }

      if (mode === 'master') {
        if ((p.state === 'ready' && p.participantState === 'ready-to-go') || p.state === 'calling') {
          res.push(
            <div
              key={p.id}
              className={`${tileFrameClassName} p-4 flex flex-col justify-center items-center gap-6 bg-yellow-400 border-2 border-orange-800 border-dashed`}
              style={{
                boxShadow: tileShadow,
              }}
            >
              <div className='text-center text-xl font-semibold leading-tight text-zinc-600 sm:text-2xl'>
                {p.name === DEFAULT_NAME ? 'Unnamed user' : p.name} is ready to join...
              </div>
              {
                setupError
                  ?
                  <div className='max-w-80 rounded border border-red-800 bg-red-100 px-4 py-2 text-center text-base font-medium text-red-900'>
                    {setupError}
                  </div>
                  : null
              }
              <Button
                disabled={p.state === 'calling' || configLoading || Boolean(setupError)}
                onClick={
                  () => {
                    makeCall(p);
                  }
                }
              >
                Admit <UserIcon size={24} />
              </Button>
            </div>
          );
        }
      }
    }

    return res;
  }, [
    participants, OwnVideo, TheirVideo, tileFrameClassName, tileShadow, makeCall, mode, participantName,
    setCallParticipantName, localStream, applyingEffects, callError, configError,
    configLoading
  ]);

  const setupError = callError || configError;
  const participantGridClassName = components.length <= 3
    ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'
    : components.length <= 6
      ? 'grid-cols-2 xl:grid-cols-3'
      : 'grid-cols-3 xl:grid-cols-4';

  return (
    components.length > 1
      ?
      <div className='flex h-full w-full flex-col items-center gap-4 overflow-y-auto px-4 py-4 sm:px-6'>
        {
          setupError
            ?
            <div className='rounded border border-red-800 bg-red-100 px-4 py-2 text-center text-lg font-medium text-red-900'>
              {setupError}
            </div>
            : null
        }
        <div className={`grid w-full max-w-[96rem] ${participantGridClassName} items-stretch gap-3 sm:gap-4`}>
          {components}
        </div>
        <div className='w-full flex flex-row justify-center items-center'>
          <Button
            onClick={endTheCall}
          >
            <CancelCallIcon size={36} /> End Call
          </Button>
        </div>
      </div>
      :
      <div className='mx-auto flex h-full w-full max-w-[96rem] flex-col items-center gap-6 overflow-y-auto px-4 py-4 text-2xl font-semibold sm:gap-8 xl:flex-row xl:items-stretch xl:justify-center'>
        <div className='w-full max-w-[40rem]'>
          <div className='relative'>
            <OwnVideo />
            {
              localStream && applyingEffects === 'none' &&
              <div
                className='absolute w-full px-4 h-16 bottom-20 z-30 flex flex-row justify-center'
              >
                <NameInput
                  participantName={participantName}
                  setParticipantName={setCallParticipantName}
                />
              </div>
            }
          </div>
        </div>
        <div className='flex w-full max-w-xl flex-col justify-between gap-8 rounded-2xl border-2 border-orange-800 bg-yellow-300/70 p-4 text-center sm:p-6 xl:min-h-[32rem] xl:text-left'>
          <div className='flex flex-col justify-center items-center gap-4 xl:items-start'>
            {
              setupError
                ?
                <div className='w-full max-w-sm rounded border border-red-800 bg-red-100 px-4 py-2 text-lg text-red-900 xl:max-w-md'>
                  {setupError}
                </div>
                : null
            }
            {
              mode === 'master'
                ?
                <div className={`flex w-full flex-col justify-center items-center gap-4 xl:items-start ${!roomId.trim() || participants.length >= MAX_PARTICIPANTS || !localStream ? 'opacity-20' : ''}`}>
                  <div>
                    Pass the link to
                    <br />
                    the other participants
                  </div>
                  <Button
                    disabled={!roomId.trim() || participants.length >= MAX_PARTICIPANTS || !localStream}
                    onClick={
                      () => {
                        navigator.clipboard.writeText(window.location.href + '?roomId=' + encodeURIComponent(roomId));
                      }
                    }
                  >
                    Copy Link <LinkIcon color='rgb(254 249 195)' />
                  </Button>
                  <div className='mt-2'>
                    or tell them the code
                  </div>
                  <div className='relative top-[-0.2rem] h-14 w-full max-w-sm px-4 flex flex-col justify-center items-center font-semibold text-2xl bg-yellow-100 text-black rounded-lg border border-solid border-orange-950 overflow-hidden shadow'>
                    <input
                      className='w-full h-full border-none bg-inherit text-center text-2xl font-semibold text-zinc-600 focus:outline-none xl:text-left'
                      value={roomId}
                      onChange={e => setRoomId(e.target.value)}
                    />
                  </div>
                </div>
                :
                <div className='flex w-full flex-col justify-center items-center gap-4 xl:items-start'>
                  {
                    participantState === 'ready-to-go'
                      ?
                      <>
                        <div className='animate-pulse'>
                          Please wait till
                          <br />
                          they let you in...
                        </div>
                      </>
                      : participants.length === 0
                        ?
                        <div className='animate-pulse'>
                          Please wait
                          <br />
                          for the host...
                        </div>
                        : participants.length < MAX_PARTICIPANTS
                          ?
                          <>
                            <div>
                              Set up the camera
                              <br />
                              and press the button
                            </div>
                            <Button
                              disabled={!localStream}
                              onClick={
                                () => setParticipantState('ready-to-go')
                              }
                            >
                              Let me in!
                            </Button>
                          </>
                          :
                          <div className='animate-pulse'>
                            We are sorry,
                            <br />
                            the room is full.
                          </div>
                  }
                </div>
            }
          </div>
          <div className='flex justify-center xl:justify-start'>
            <Button
              onClick={endTheCall}
            >
              <CancelCallIcon size={36} /> End Call
            </Button>
          </div>
        </div>
      </div>
  );
};

export default function Page() {
  const [home, setHome] = useState(true);
  const [roomId, setRoomId] = useState<string>('');

  useEffect(() => {
    if (URL.canParse(window.location.href)) {
      const url = new URL(window.location.href);
      const roomId = url.searchParams.get('roomId');
      if (roomId) {
        setRoomId(roomId);
        setHome(false);
      }
    }
  }, []);

  return (
    <div className={`flex w-full min-h-full flex-col items-center gap-8 sm:gap-12 ${home ? 'justify-center' : 'justify-start'}`}>
      {
        home ?
          <>
            <div className='w-full max-w-5xl overflow-hidden text-center'>
              <h1 className='relative z-10 flex flex-col items-center font-bold leading-[1.05] text-[clamp(2rem,6vw,3rem)]'>
                <span
                  style={{
                    textShadow: '3px 3px #fff59d'
                  }}
                >
                  GDMN Meet is a free privacy-first
                </span>
                <span
                  style={{
                    textShadow: '3px 3px #fff59d'
                  }}
                >
                  true P2P video call solution
                </span>
                <span
                  style={{
                    textShadow: '3px 3px #fff59d'
                  }}
                >
                  for direct WebRTC meetings in the browser
                </span>
              </h1>
            </div>
            <div className='flex w-full max-w-5xl flex-col items-center gap-4 lg:flex-row lg:justify-center'>
              <Button onClick={() => setHome(false)}>
                Start a Call
              </Button>
              <div className='relative h-14 w-full max-w-xl px-4 flex flex-col justify-center items-center font-semibold text-2xl bg-yellow-100 text-black rounded-lg border border-solid border-orange-950 overflow-hidden shadow'>
                <input
                  className='w-full h-full border-none bg-inherit text-center font-semibold text-xl text-zinc-600 focus:outline-none sm:text-2xl lg:text-left'
                  type='text'
                  value={roomId}
                  placeholder='...or enter a code or link and'
                  onPaste={
                    e => {
                      e.preventDefault();
                      const clipboardData = e.clipboardData.getData('text');
                      const url = URL.canParse(clipboardData) ? new URL(clipboardData) : null;
                      const fromUrl = url?.searchParams?.get('roomId');
                      setRoomId(fromUrl || clipboardData);
                    }
                  }
                  onChange={e => setRoomId(e.target.value)}
                />
              </div>
              <Button
                disabled={!roomId.trim()}
                onClick={() => setHome(false)}
              >
                Join the Call
              </Button>
            </div>
            <div className='w-full max-w-4xl overflow-hidden text-center text-base font-bold sm:text-xl'>
              <div className='relative flex flex-col items-center z-10'>
                <div
                  style={{
                    textShadow: '3px 3px #fff59d'
                  }}
                >
                  ✱ some VPNs may block p2p connections. Turn them off if affected.
                </div>
              </div>
            </div>
          </>
          :
          <VideoCall
            onCallEnd={
              () => {
                setRoomId('');
                setHome(true);
              }
            }
            enterByRoomId={roomId}
          />
      }
    </div >
  );
};
