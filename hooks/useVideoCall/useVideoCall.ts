'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { v4 } from 'uuid';
import { convertBytes } from '@/lib/format';
import { SimpleEventEmitter } from '@/lib/simple-event-emitter';
import { CustomMessage, formatId, isAddressedMessage, isBroadcastMessage, Message, Participant, SetVideoReadyState, Signal, SocketStatus, UseVideoCallProps, WebRTCConfig } from './types';
import { useWebRTCConfig } from './useWebRTCConfig';

const timestamp = () => new Date().toISOString().slice(11, 23);
const log = (...args: any[]) => console.log(timestamp(), ...args);

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export const ufragMatch = (sdp?: string) => sdp && sdp.match(/a=ice-ufrag:(\S+)/)?.[1];
export const formatToNow = (duration: number) => `${((Date.now() - duration) / 1000).toFixed(0)} s`;
//export const toKb = (bytes: number | undefined) => (bytes ? (bytes / 1024).toFixed() : '--');
export const missedHeartbeat = (heartbeatReceived?: number) =>
  !!heartbeatReceived && ((Date.now() - heartbeatReceived) > heartbeatThreshold);

export const formatPriority = (priority: number | null) =>
  priority ? [priority >> 24, (priority >> 8) & 0xffff, priority & 0xff].join(' | ') : '';

function normalizeIceServers(value: unknown): WebRTCConfig['stun'] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.reduce<WebRTCConfig['stun']>((servers, server) => {
    if (!server || typeof server !== 'object') {
      return servers;
    }

    const urls = Array.isArray((server as WebRTCConfig['stun'][number]).urls)
      ? (server as WebRTCConfig['stun'][number]).urls.filter(
        (url): url is string => typeof url === 'string' && url.length > 0
      )
      : [];

    if (urls.length === 0) {
      return servers;
    }

    servers.push({
      urls,
      username: typeof (server as WebRTCConfig['stun'][number]).username === 'string'
        ? (server as WebRTCConfig['stun'][number]).username
        : undefined,
      credential: typeof (server as WebRTCConfig['stun'][number]).credential === 'string'
        ? (server as WebRTCConfig['stun'][number]).credential
        : undefined,
    });

    return servers;
  }, []);
}

export function normalizeWebRTCConfig(config: WebRTCConfig): WebRTCConfig {
  return {
    stun: normalizeIceServers(config?.stun),
    turn: normalizeIceServers(config?.turn),
    icePolicy: config?.icePolicy === 'relay' ? 'relay' : 'all',
  };
}

export const getRTCConfiguration = (rawConfig: WebRTCConfig): RTCConfiguration => {
  const { stun, turn, icePolicy } = normalizeWebRTCConfig(rawConfig);
  const config: RTCConfiguration = {
    iceServers: [
      ...turn
        .map(s => ({
          urls: s.urls,
          username: s.username || '1',
          credential: s.credential || '1',
        })),
      ...stun
        .map(s => ({ urls: s.urls })),
    ].filter(Boolean),
    iceTransportPolicy: icePolicy,
  };

  const sanitizedConfig = {
    ...config,
    iceServers: config.iceServers?.map(server => {
      const { username, credential, ...rest } = server;
      return rest;
    })
  };

  log('stun/turn config', sanitizedConfig);

  return config;
};

const heartbeatDelay = 2500;
const heartbeatThreshold = heartbeatDelay * 2;
const statsDelay = 5_001;
const recoveryDelay = 18_000;
const iceRestartDelay = recoveryDelay / 2;
const videoWarmUpDelay = 8_000;
const waitingForInternetDelay = 60_000;

export function formatHeartbeat(prefix: string, heartbeatReceived?: number, hideEmpty = false) {
  if (!heartbeatReceived) {
    return hideEmpty ? '' : `${prefix}-no-data`;
  }

  if (missedHeartbeat(heartbeatReceived)) {
    return `${prefix}-dead`;
  } else {
    return `${prefix}-alive`;
  }
}

export function formatBytes<S>(p: Participant<S>) {
  if (
    p.statInterval &&
    p.bytesSent !== undefined &&
    p.bytesReceived !== undefined &&
    p.bytesTime !== undefined
  ) {
    let totalRes = '';

    if (
      p.bytesPrevSent !== undefined &&
      p.bytesPrevReceived !== undefined &&
      p.bytesPrevTime !== undefined
    ) {
      const deltaTime = p.bytesTime - p.bytesPrevTime;
      const deltaSent = p.bytesSent - p.bytesPrevSent;
      const deltaReceived = p.bytesReceived - p.bytesPrevReceived;
      const divider = deltaTime / 1000 || 1;
      totalRes = `total: sent ${convertBytes(p.bytesSent)} / received ${convertBytes(p.bytesReceived)}, 1s: sent ${convertBytes(deltaSent / divider)} / received ${convertBytes(deltaReceived / divider)}`;
    } else {
      totalRes = `total: sent ${convertBytes(p.bytesSent)} / ${convertBytes(p.bytesReceived)}`;
    }

    let audioRes = '';

    if (
      p.bytesAudioSent !== undefined &&
      p.bytesAudioReceived !== undefined) {
      if (
        p.bytesPrevAudioSent !== undefined &&
        p.bytesPrevAudioReceived !== undefined &&
        p.bytesPrevTime !== undefined
      ) {
        const deltaTime = p.bytesTime - p.bytesPrevTime;
        const deltaSent = p.bytesAudioSent - p.bytesPrevAudioSent;
        const deltaReceived = p.bytesAudioReceived - p.bytesPrevAudioReceived;
        const divider = deltaTime / 1000 || 1;
        audioRes = `audio: sent ${convertBytes(p.bytesAudioSent)} / received ${convertBytes(p.bytesAudioReceived)}, 1s: sent ${convertBytes(deltaSent / divider)} / received ${convertBytes(deltaReceived / divider)}`;
      } else {
        audioRes = `audio: sent ${convertBytes(p.bytesAudioSent)} / received ${convertBytes(p.bytesAudioReceived)}`;
      }
    } else {
      audioRes = 'no audio data';
    }

    return totalRes + '; ' + audioRes;
  } else {
    return '';
  }
}

/**
 * Checks if connection is alive by bytes transmission.
 * @param p
 * @returns
 */
function isDataTransmitted<S>(p: Participant<S>) {
  if (
    p.statInterval &&
    p.bytesReceived !== undefined &&
    p.bytesTime !== undefined &&
    p.bytesPrevReceived !== undefined &&
    p.bytesPrevTime !== undefined &&
    p.bytesSent !== undefined &&
    p.bytesPrevSent !== undefined
  ) {
    const deltaTime = p.bytesTime - p.bytesPrevTime;
    const deltaReceived = p.bytesReceived - p.bytesPrevReceived;
    const deltaSent = p.bytesSent - p.bytesPrevSent;
    // only judge if there were enough time to transmit some data
    // Connection is alive if EITHER data is being received OR sent (not both required)
    return deltaTime < statsDelay || (deltaReceived > 0 || deltaSent > 0);
  } else {
    return true;
  }
}

// function isAudioDataTransmitted<S>(p: Participant<S>) {
//   if (
//     p.statInterval &&
//     p.bytesAudioReceived !== undefined &&
//     p.bytesTime !== undefined &&
//     p.bytesPrevAudioReceived !== undefined &&
//     p.bytesPrevTime !== undefined &&
//     p.bytesAudioSent !== undefined &&
//     p.bytesPrevAudioSent !== undefined
//   ) {
//     const deltaTime = p.bytesTime - p.bytesPrevTime;
//     const deltaReceived = p.bytesAudioReceived - p.bytesPrevAudioReceived;
//     const deltaSent = p.bytesAudioSent - p.bytesPrevAudioSent;
//     // only judge if there were enough time to transmit some data
//     return deltaTime < statsDelay || (deltaReceived > 0 && deltaSent > 0);
//   } else {
//     return true;
//   }
// }

// function isAudioDataSent<S>(p: Participant<S>) {
//   if (
//     p.statInterval &&
//     p.bytesTime !== undefined &&
//     p.bytesPrevTime !== undefined &&
//     p.bytesAudioSent !== undefined &&
//     p.bytesPrevAudioSent !== undefined
//   ) {
//     const deltaTime = p.bytesTime - p.bytesPrevTime;
//     const deltaSent = p.bytesAudioSent - p.bytesPrevAudioSent;
//     // only judge if there were enough time to transmit some data
//     return deltaTime < statsDelay || deltaSent > 0;
//   } else {
//     return true;
//   }
// }

// function isAudioDataReceived<S>(p: Participant<S>) {
//   if (
//     p.statInterval &&
//     p.bytesTime !== undefined &&
//     p.bytesPrevTime !== undefined &&
//     p.bytesAudioReceived !== undefined &&
//     p.bytesPrevAudioReceived !== undefined
//   ) {
//     const deltaTime = p.bytesTime - p.bytesPrevTime;
//     const deltaReceived = p.bytesAudioReceived - p.bytesPrevAudioReceived;
//     // only judge if there were enough time to transmit some data
//     return deltaTime < statsDelay || deltaReceived > 0;
//   } else {
//     return true;
//   }
// }

// function isAudioEnabled(s: MediaStream | undefined | null) {
//   return s && s.getAudioTracks().every(t => t.enabled);
// }


type UseVideoCallReturn<S, M, D> = {
  /**
   * Name of the participant.
   */
  participantName: string,
  /**
   * State of the participant.
   */
  participantState: S | undefined;
  /**
   * Function allows to change the name of the participant after the hook is initialized.
   */
  setParticipantName: (name: string) => void,
  /**
   * Function allows to change the state of the participant after the hook is initialized.
   */
  setParticipantState: (state: S | undefined) => void,
  /**
   * Media stream of the local camera and microphone.
   */
  localStream: MediaStream | null,
  /**
   * Function to set the local stream.
   */
  setLocalStream: (stream: MediaStream | null) => void,
  /**
   * Function to propagate state of the local audio and video tracks.
   */
  enableTrack: (track: 'audio' | 'video', enabled: boolean) => void,
  /**
   * Callback function to set the video ready state of the participant.
   * Used for the video element to detect when the video is ready to play.
   */
  setVideoReadyState: SetVideoReadyState,
  /**
   * Web RTC connection configuration.
   */
  config: WebRTCConfig | null,
  /**
   * Function to set the Web RTC connection configuration.
   * Can be changed prior to the call.
   */
  setConfig: (config: WebRTCConfig) => void,
  /**
   * List of participants in the room.
   */
  participants: Participant<S>[],
  /**
   * Socket instance
   */
  socket: Socket | null,
  /**
   * Status of the Web Socket connection used for the signaling
   * and call establishment.
   */
  socketStatus: SocketStatus,
  /**
   * Function to make a call to the participant.
   * If the participant is not provided, the hook will try to call all participants in the room.
   */
  makeCall: (participant?: Participant<S>, dontCallGroup?: boolean) => Promise<void>,
  /**
   * Function to end the call with the participant.
   */
  endCall: (participant: Participant<S>, error?: string) => void,
  /**
   * Function to restart the call with the participant.
   */
  restartCall: (participant: Participant<S>) => void,
  /**
   * Function to start the process of gathering ICE candidates and
   * re-starting the Web RTC connection.
   */
  restartIce: (participant: Participant<S>) => void,
  /**
   * Can we restart ICE gathering?
   */
  canRestartIce: (participant: Participant<S>) => boolean,
  /**
   * Send a custom message to the participant or to all participants in the room.
   */
  sendMessage: (participant: Participant<S> | undefined, data: M, metadata?: D) => void,
  /**
   * Here we can subscribe to the messages from the participants.
   */
  subscribe: (onMessage: (message: CustomMessage<M, D>) => void) => void,
  unsubscribe: (onMessage?: (message: CustomMessage<M, D>) => void) => void,
  /**
   * Function to clear the error of the participant.
   */
  clearParticipantError: (participant: Participant<S>) => void,
  /**
   * Error state of the hook. Don't confuse with the error state of the participant.
   */
  //TODO: remove this
  error: string,
  /**
   * Error wile setting the Web RTC configuration.
   */
  configError: string | null,
  /**
   * Loading state of the Web RTC configuration.
   */
  configLoading: boolean,
  /**
   * Function to clear the error state of the hook.
   */
  clearError: () => void,
  /**
   * Participant with the same ID is already in the room. Probably in another tab.
   */
  alreadyInRoom: boolean,
  /**
   * Get actual participant by ID.
   */
  getParticipant: (pId: string) => Participant<S> | undefined,
  /**
   * Force update the hook state.
   */
  forceUpdate: () => void,
  /**
   * Switch the track of the local stream.
   * @param track
   * @param newStream
   * @returns
   */
  switchTrack: (track: 'audio' | 'video', newStream: MediaStream) => void;
};

export function useVideoCall<
  S = string | undefined,
  M = string | undefined,
  D = undefined
>(props: UseVideoCallProps<S>): UseVideoCallReturn<S, M, D> {
  const { homeUrl, peerServerUrl, socketPath, roomId, participantId, organizationId } = props;

  // console.log('homeUrl', homeUrl);
  // console.log('peerServerUrl', peerServerUrl);
  // console.log('socketPath', socketPath);

  if (!roomId) {
    throw new Error('Room ID is required');
  }

  if (!participantId) {
    throw new Error('Participant ID is required');
  }

  // ✅ Используем динамическую загрузку WebRTC конфигурации
  const { config: dynamicConfig, loading: configLoading, error: configError } = useWebRTCConfig();

  const [participantName, setParticipantName] = useState(props.participantName);
  const [participantState, setParticipantState] = useState(props.participantState);
  const [participants, setParticipants] = useState<Participant<S>[]>([]);
  // ✅ Приоритет: пропсы → динамическая конфигурация → дефолт
  const [config, setConfig] = useState(
    props.config ?? dynamicConfig ?? null
  );
  const [error, setError] = useState<string>('');
  const [connectionError, setConnectionError] = useState<string>('');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [socketStatus, setSocketStatus] = useState<SocketStatus>('initial');
  const [alreadyInRoom, setAlreadyInRoom] = useState(false);
  const [lastSocketConnected, setLastSocketConnected] = useState<number | undefined>();
  const [instanceId] = useState(v4());

  const ownRef = useRef<HTMLVideoElement | null>(null);
  const participantsRef = useRef(participants);
  const localStreamRef = useRef(localStream);
  const onMessageRef = useRef<(message: Message<S, M, D>) => void>();
  const eventEmitterRef = useRef(
    new SimpleEventEmitter<{ CUSTOM_MESSAGE: CustomMessage<M, D> }>()
  );
  const alreadyInRoomRef = useRef(alreadyInRoom);

  participantsRef.current = participants;
  localStreamRef.current = localStream;
  alreadyInRoomRef.current = alreadyInRoom;

  const isAudioEnabled = useCallback(() => Boolean(localStreamRef.current?.getAudioTracks().some(track => track.enabled && track.readyState === 'live' /*&& !track.muted*/)), []);
  const isVideoEnabled = useCallback(() => Boolean(localStreamRef.current?.getVideoTracks().some(track => track.enabled && track.readyState === 'live' /*&& !track.muted*/)), []);

  const checkParticipantHasPeerConnection = (p: Participant<S>) => {
    if (!p.pc) {
      throw new Error('Peer connection is not ready');
    }

    if (!p.sessionId) {
      throw new Error('Session ID is not ready');
    }

    return p as Required<Participant<S>>;
  };

  const emit = useCallback((message: Message<S, M, D>) => {
    if (socket) {
      if (message.type !== 'SOCKET_PING' && message.type !== 'SOCKET_PONG') {
        log(
          'emit',
          message.type,
          formatId((message.payload as any).fromId),
          '-->',
          formatId((message.payload as any).toId)
        );
      }
      socket.emit('message', message);
    }
  }, [socket]);

  const find = (pId: string) => participantsRef.current.find(p => p.id === pId);

  const remove = (pId: string) => {
    const index = participantsRef.current.findIndex(p => p.id === pId);
    if (index >= 0) {
      const removed = participantsRef.current.splice(index, 1);
      setParticipants([...participantsRef.current]);
      return removed[0];
    } else {
      return undefined;
    }
  };

  const filter = (fn: (p: Participant<S>) => (boolean | number | undefined)) => participantsRef.current.filter(fn);

  const assignParticipants = (participants: Participant<S>[], updateState = true) => {
    // console.log('assignParticipants', updateState);
    // if (updateState) {
    //   console.trace();
    // }
    participantsRef.current = participants;
    updateState && setParticipants(participants);
  };

  const mapParticipants = (fn: (p: Participant<S>) => Participant<S>, updateState = true) => {
    assignParticipants(participantsRef.current.map(fn), updateState);
  };

  const updateParticipant = (
    pId: string,
    updater: ((p: Participant<S>) => Participant<S>) | Partial<Participant<S>>,
    updateState = true
  ) => {
    if (typeof updater === 'function') {
      mapParticipants(p => (p.id === pId ? updater(p) : p), updateState);
    } else {
      mapParticipants(p => (p.id === pId ? { ...p, ...updater } : p), updateState);
    }
  };

  const makeCall = useCallback(async (participant?: Participant<S>, dontCallGroup?: boolean) => {
    if (!participant) {

      const done: string[] = [];

      while (true) {
        if (done.length) {
          await pause(1000);
        }

        const p = participantsRef.current.find(p => p.state === 'ready' && !done.includes(p.id));

        if (!p) {
          break;
        }

        done.push(p.id);
        await makeCall(p);
      }

      return;
    }

    log('makeCall', formatId(participant.id), participant.role);

    if (!socket || socket.disconnected) {
      setError('Socket is not ready');
      return;
    }

    if (!config) {
      if (configLoading) {
        setError('Config is loading');
        return;
      }
      if (configError) {
        setError(configError);
        return;
      }

      setError('Config is not ready');
      return;

    }

    if (participant.state !== 'ready') {
      setError('Participant is not ready');
      return;
    }

    if (!localStream) {
      setError('Local stream is not ready');
      return;
    }

    if (participant.pc) {
      setError('Peer connection is already established');
      return;
    }

    const sessionId = v4();
    const eligibleParticipants = filter(p => p.id !== participant.id && p.state === 'in-call');

    let negotiatedParticipant: Participant<S> | undefined;

    updateParticipant(participant.id, p => {
      negotiatedParticipant = createPerfectNegotiation(
        p,
        normalizeWebRTCConfig(config),
        true,
        sessionId
      );
      return negotiatedParticipant;
    });

    if (
      !negotiatedParticipant?.pc ||
      negotiatedParticipant.sessionId !== sessionId ||
      negotiatedParticipant.state === 'error'
    ) {
      setError(
        negotiatedParticipant?.error ??
        'Failed to initialize the peer connection'
      );
      return;
    }

    emit({
      type: 'CALLING',
      payload: {
        fromId: participantId,
        toId: participant.id,
        sessionId,
        config,
      },
    });

    if (!dontCallGroup) {

      for (const eligibleParticipant of eligibleParticipants) {
        if (socket?.connected) {
          await pause(1000);
          emit({
            type: 'MAKE_CALL',
            payload: {
              fromId: participantId,
              toId: participant.id,
              calleeId: eligibleParticipant.id,
            },
          });
        }
      }
    }
  }, [socket, emit, participantId, localStream, config]);

  const endCall = useCallback((participant: Participant<S>, error?: string) => {
    log('endCall', formatId(participant.id), participant.role, error);

    const { sessionId } = checkParticipantHasPeerConnection(participant);

    emit({
      type: 'END_CALL',
      payload: {
        fromId: participantId,
        toId: participant.id,
        sessionId,
      },
    });

    const removed = remove(participant.id);

    if (removed) {
      clearConnection(removed);
    }

    emit({
      type: 'ENUM',
      payload: {
        fromId: participantId,
      },
    });
  }, [participantId, emit]);

  const restartCall = useCallback((participant: Participant<S>) => {
    log('restartCall', formatId(participant.id), participant.role);

    if (!socket) {
      setError('Socket is not ready');
      return;
    }

    if (!localStream) {
      setError('Local stream is not ready');
      return;
    }

    if (participant.role !== 'caller') {
      setError('Participant is not a caller');
      return;
    }

    if (participant.state !== 'in-call' && participant.state !== 'calling') {
      setError('Participant is not in call');
      return;
    }

    if (!config) {
      if (configLoading) {
        setError('WebRTCConfig is loading');
        return;
      }
      if (configError) {
        setError(configError);
        return;
      }

      setError('WebRTCConfig is not ready');
      return;

    }


    const sessionId = v4();

    let negotiatedParticipant: Participant<S> | undefined;

    updateParticipant(participant.id, p => {
      negotiatedParticipant = createPerfectNegotiation(
        clearConnection(p),
        normalizeWebRTCConfig(config),
        true,
        sessionId
      );
      return negotiatedParticipant;
    });

    if (
      !negotiatedParticipant?.pc ||
      negotiatedParticipant.sessionId !== sessionId ||
      negotiatedParticipant.state === 'error'
    ) {
      setError(
        negotiatedParticipant?.error ??
        'Failed to restart the peer connection'
      );
      return;
    }

    emit({
      type: 'CALLING',
      payload: {
        fromId: participantId,
        toId: participant.id,
        sessionId,
        config,
      },
    });
  }, [socket, emit, participantId, localStream, config]);

  const sendMessage = useCallback((
    participant: Participant<S> | undefined,
    data: M,
    metadata?: D
  ) => {
    if (!socket?.connected) {
      throw new Error('Socket is not ready');
    }

    emit({
      type: 'CUSTOM_MESSAGE',
      payload: {
        fromId: participantId,
        toId: participant?.id,
        data,
        ...(metadata && { metadata })
      },
    });
  }, [socket, emit, participantId]);

  const subscribe = useCallback((onMessage: (message: CustomMessage<M, D>) => void) => {
    eventEmitterRef.current.on('CUSTOM_MESSAGE', onMessage);
  }, []);

  const unsubscribe = useCallback((onMessage?: (message: CustomMessage<M, D>) => void) => {
    if (onMessage) {
      eventEmitterRef.current.off('CUSTOM_MESSAGE', onMessage);
    } else {
      eventEmitterRef.current.removeAllListeners();
    }
  }, []);

  const clearParticipantError = useCallback((participant: Participant<S>) => {
    const found = find(participant.id);

    if (found && found.error) {
      updateParticipant(participant.id, {
        state: 'initial',
        error: undefined,
      });

      emit({
        type: 'ENUM',
        payload: {
          fromId: participantId,
        },
      });
    }
  }, [emit, participantId]);

  // ✅ Обновляем конфигурацию при загрузке динамической конфигурации
  useEffect(() => {
    // Если есть пропс конфиг - используем его
    if (props.config) {
      setConfig(props.config);
      clearError();
      return;
    }

    // Если динамический конфиг загружается - ждем
    if (configLoading) {
      return;
    }

    // Если динамический конфиг загружен успешно - используем его
    if (dynamicConfig && !configError) {
      setConfig(dynamicConfig);
      clearError();
      return;
    }

    // ✅ FALLBACK: если ошибка загрузки динамического конфига - используем дефолтный
    if (configError) {
      // console.warn('Failed to load dynamic WebRTC config, using default:', configError);
      // setConfig(defWebRTCConfig);
      // console.log("*** CONFIG ***: ", config)
      // clearError(); // Очищаем ошибку, так как используем fallback
      return;
    }

    // Если динамический конфиг не загружен и нет ошибки - ошибка состояния
    setError("WebRTC config is not ready");
  }, [dynamicConfig, configLoading, configError, props.config]);

  useEffect(() => {
    return () => {
      eventEmitterRef.current.removeAllListeners();
      stopMediaStream();
      participantsRef.current.forEach(p => clearConnection(p));
      participantsRef.current = [];
    };
  }, []);

  useEffect(() => {
    let changed = false;

    const newParticipants = participants.map(p => {
      if (
        p.state === 'in-call' &&
        p.connectionState === 'connected' &&
        p.iceConnectionState === 'connected' &&
        p.stream &&
        p.stream.active &&
        !p.wasOk
      ) {
        changed = true;
        return {
          ...p,
          wasOk: true,
        };
      }
      return p;
    });

    if (changed) {
      participantsRef.current = newParticipants;
      setParticipants(newParticipants);
    }
  }, [participants]);

  useEffect(() => {
    const interval = setInterval(() => {
      try {
        const stalledGathering = filter(p => p.role === 'caller'
          && (p.state === 'calling' || p.state === 'in-call')
          && !p.connectionState
          && p.iceGatheringState === 'gathering'
          && p.lastIceGatheringStateChange
          && Date.now() - p.lastIceGatheringStateChange > iceRestartDelay
        );

        stalledGathering.forEach(p => {
          log('restart call due to stalled gathering', formatId(p.id));
          restartCall(p);
        });

        const unrecoverableErrors = filter(p => p.unrecoverableError);

        if (unrecoverableErrors.length) {
          unrecoverableErrors.forEach(p => {
            if (p.state === 'in-call' && p.pc) {
              if (p.role === 'caller') {
                log('restart call due to unrecoverable error');
                restartCall(p);
              } else {
                updateParticipant(p.id, { unrecoverableError: undefined });

                if (!p.sessionId) {
                  throw new Error('Session ID is not ready');
                }

                log('requesting restart call due to unrecoverable error...');
                emit({
                  type: 'RESTART_CALL',
                  payload: {
                    fromId: participantId,
                    toId: p.id,
                    sessionId: p.sessionId,
                  },
                });
              }
            } else {
              updateParticipant(p.id, { unrecoverableError: undefined });
            }
          });
        }

        const callingInLimbo = filter(
          p => p.state === 'calling' && p.callStarted && (Date.now() - p.callStarted) > recoveryDelay
        );

        callingInLimbo.forEach(p => {
          // usually this is the case when the socket is dead and needs to be recreated
          log('calling in limbo', formatId(p.id), p.role);
          updateParticipant(p.id, { ...clearConnection(p), state: 'error', error: 'Call cannot be established. Please try again.' });
        });

        const inCall = filter(
          p => p.problemDiscovered
            ||
            p.preProblemDiscovered
            ||
            (
              p.state === 'in-call'
              &&
              (
                p.wasOk
                ||
                (
                  p.callStarted
                  &&
                  Date.now() - (p.callResolved ?? p.callStarted) > videoWarmUpDelay
                )
              )
            )
        );

        for (const p of inCall) {
          const iceNotConnected =
            p.iceConnectionState === 'failed' ||
            p.iceConnectionState === 'disconnected' ||
            p.iceConnectionState === 'closed';

          let checkProblem =
            p.connectionState === 'failed' ||
            iceNotConnected ||
            (p.stream && !p.stream.active) ||
            !p.stream ||
            !isDataTransmitted(p);
          //(isAudioEnabled(localStream) && !isAudioDataSent(p)) ||
          //(isAudioEnabled(p.stream) && !isAudioDataReceived(p));

          if (!checkProblem) {
            if (typeof p.videoReadyState === 'number' && p.videoReadyState < 3) {
              if (
                p.callStarted &&
                Date.now() - (p.callResolved ?? p.callStarted) > videoWarmUpDelay
              ) {
                checkProblem = true;
              }
              // Don't set checkProblem if video is still loading but connection is good
              // This allows problemDiscovered to be cleared properly
            }
          }

          if (checkProblem) {
            // let waiting for a while to recover
            if (p.problemDiscovered) {
              let socketPingRestored = p.socketPingRestored;

              if (socketPingRestored && missedHeartbeat(p.socketPingReceived)) {
                socketPingRestored = undefined;
                updateParticipant(p.id, { socketPingRestored });
              }

              let elapsed = Date.now() - Math.max(
                p.problemDiscovered,
                lastSocketConnected ?? 0,
                socketPingRestored ?? 0,
                (
                  p.iceConnectionState === 'connected'
                  || p.iceConnectionState === 'completed'
                  || p.iceConnectionState === 'checking'
                )
                  && p.lastIceStateChange
                  ? p.lastIceStateChange
                  : 0
              );

              if (elapsed > recoveryDelay) {
                // seems to be a real problem
                // if there is no internet connection, we would wait a bit longer
                if (
                  !socket?.connected ||
                  !navigator.onLine ||
                  missedHeartbeat(p.socketPingReceived)
                ) {
                  if (elapsed > waitingForInternetDelay) {
                    if (!socket?.connected) {
                      endCall(p, 'Connection lost. Please check internet connection.');
                    } else {
                      endCall(p);
                    }
                  } else {
                    updateParticipant(p.id, { healthCheck: Date.now() });
                  }
                } else {
                  if (p.role === 'caller') {
                    restartCall(p);
                  } else {
                    // caller must manage the call, but if it avoids its responsibilities...
                    if (elapsed > (waitingForInternetDelay + recoveryDelay)) {
                      endCall(p);
                    } else {
                      updateParticipant(p.id, { healthCheck: Date.now() });
                    }
                  }
                }
              } else {
                if (socket?.connected
                  && navigator.onLine
                  && !missedHeartbeat(p.socketPingReceived)
                  && !p.restartIceTried
                  && (
                    p.connectionState === 'failed'
                    ||
                    (p.connectionState === 'disconnected' && elapsed > iceRestartDelay)
                    ||
                    (p.connectionState === 'connected' && !isDataTransmitted(p))
                  )
                  && p.role === 'caller'
                  && p.pc
                ) {
                  log('restartIce', formatId(p.id), p.role);
                  updateParticipant(p.id, { restartIceTried: Date.now() });
                  p.pc.restartIce();
                } else {
                  updateParticipant(p.id, { healthCheck: Date.now() });
                }
              }
            } else {
              if (p.preProblemDiscovered) {
                log('problem discovered', formatId(p.id), p.role);
                updateParticipant(p.id, {
                  problemDiscovered: p.preProblemDiscovered,
                  restartIceTried: undefined,
                });
              } else {
                updateParticipant(p.id, {
                  preProblemDiscovered: Date.now(),
                  restartIceTried: undefined,
                });
              }
            }
          } else {
            // seems to be ok. the problem is resolved
            if (p.problemDiscovered) {
              log('Problem resolved', formatId(p.id), p.role);

              updateParticipant(p.id, {
                callResolved: Date.now(),
                problemDiscovered: undefined,
                preProblemDiscovered: undefined,
              });
            }
            else if (p.preProblemDiscovered) {
              updateParticipant(p.id, {
                preProblemDiscovered: undefined
              });
            }
          }
        }
      } catch (err: any) {
        console.error(err);
      }
    }, heartbeatDelay);

    return () => clearInterval(interval);
  }, [socket, participantId, endCall, restartCall, emit]);

  function startConnection(participant: Participant<S>, audioEnabled: boolean, videoEnabled: boolean) {
    log('startConnection', formatId(participant.id), participant.role);

    if (!localStream) {
      throw new Error('Local stream is not ready');
    }

    if (!socket) {
      throw new Error('Socket is not ready');
    }

    if (!participant.pc) {
      throw new Error('Peer connection is not ready');
    }

    if (!participant.sessionId) {
      throw new Error('Session ID is not ready');
    }

    localStream.getTracks().forEach(track => {
      participant.pc && participant.pc.addTrack(track, localStream!);
    });

    updateParticipant(participant.id, {
      callStarted: Date.now(),
      callResolved: undefined,
      state: 'in-call',
      audioEnabled,
      videoEnabled,
    });
  };

  function createPerfectNegotiation(
    participant: Participant<S>,
    config: WebRTCConfig,
    polite: boolean,
    sessionId: string,
    onStateChanged?: (state: string) => void
  ): Participant<S> {
    log('createPerfectNegotiation', formatId(participant.id), participant.role, polite);

    if (!localStream || !socket) {
      throw new Error('Local stream or socket is not ready');
    }

    if (participant.pc) {
      throw new Error('Peer connection is already established');
    }

    if (participant.signalHandler) {
      throw new Error('Signal handler is already established');
    }

    if (!config) {
      throw new Error('Config is not ready');
    }

    let pc: RTCPeerConnection;

    try {
      pc = new RTCPeerConnection(getRTCConfiguration(config));
    } catch (error) {
      console.error('Failed to create RTCPeerConnection:', error);

      // Устанавливаем ошибку для участника, чтобы предотвратить повторные попытки
      const errorMessage = error instanceof Error ? error.message : 'Failed to create WebRTC connection';

      setConnectionError(`Failed to create RTCPeerConnection: ${errorMessage}`);

      return {
        ...participant,
        state: 'error',
        error: `WebRTC configuration error: ${errorMessage}`,
      };
    }

    pc.ontrack = ({ track, streams }) => {
      // Set stream immediately when track arrives
      const found = find(participant.id);
      if (found && streams[0] && found.stream !== streams[0]) {
        updateParticipant(participant.id, { stream: streams[0] });
      }

      // Also update on unmute for legacy support
      track.onunmute = () => {
        const found = find(participant.id);
        if (found && streams[0] && found.stream !== streams[0]) {
          updateParticipant(participant.id, { stream: streams[0] });
        }
      };
    };

    let makingOffer = false;
    const regex = /a=setup:(actpass|active|passive)/g;

    pc.onnegotiationneeded = async () => {
      try {
        makingOffer = true;
        await pc.setLocalDescription();

        const matches = pc.localDescription?.sdp?.match(regex);
        log(
          'negotiationneeded outcoming local description',
          pc.localDescription?.type,
          matches?.join(', ')
        );

        emit({
          type: 'SIGNAL',
          payload: {
            fromId: participantId,
            toId: participant.id,
            sessionId,
            description: pc.localDescription,
          },
        });
      } catch (err) {
        console.error(err);
      } finally {
        makingOffer = false;
      }
    };

    // send any ice candidates to the other peer
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        // Send the candidate immediately if the remote description is set
        emit({
          type: 'SIGNAL',
          payload: {
            fromId: participantId,
            toId: participant.id,
            sessionId,
            candidate,
          },
        });
      }
    };

    let ignoreOffer = false;

    const signalHandler = async (message: Signal) => {
      if (
        message.type !== 'SIGNAL' ||
        message.payload.toId !== participantId ||
        message.payload.fromId !== participant.id ||
        message.payload.sessionId !== sessionId
      ) {
        return;
      }

      const { candidate, description } = message.payload;

      log(
        'SIGNAL',
        formatId(message.payload.fromId),
        '-->',
        formatId(message.payload.toId),
        candidate?.type,
        description?.type
      );

      try {
        if (description) {
          const offerCollision =
            description.type === 'offer' && (makingOffer || pc.signalingState !== 'stable');

          ignoreOffer = !polite && offerCollision;
          if (ignoreOffer) {
            return;
          }

          const matches = description.sdp?.match(regex);
          log('incoming remote description', description.type, matches?.join(', '));

          await pc.setRemoteDescription(description);
          if (description.type === 'offer') {
            await pc.setLocalDescription();

            const matches = pc.localDescription?.sdp?.match(regex);
            log(
              'outcoming local description',
              pc.localDescription?.type,
              matches?.join(', ')
            );

            emit({
              type: 'SIGNAL',
              payload: {
                fromId: participantId,
                toId: participant.id,
                sessionId,
                description: pc.localDescription,
              },
            });
          }
        } else if (candidate) {
          try {
            if (pc.remoteDescription?.type) {
              await pc.addIceCandidate(candidate);
            }
          } catch (err) {
            if (!ignoreOffer) {
              throw err;
            }
          }
        }
      } catch (err: any) {
        updateParticipant(participant.id, { unrecoverableError: true });
        console.error('recovery process started for the error: ', err);
      }
    };

    pc.onconnectionstatechange = () => {
      const connectionState = pc.connectionState;
      log('onconnectionstatechange', formatId(participant.id), connectionState);
      updateParticipant(participant.id, { connectionState, lastStateChange: Date.now() });
    };

    pc.oniceconnectionstatechange = () => {
      const iceConnectionState = pc.iceConnectionState;
      log('oniceconnectionstatechange', formatId(participant.id), iceConnectionState);

      let icePair = undefined;
      let ufrag = undefined;

      if (iceConnectionState === 'connected') {
        const iceTransport = pc.getSenders()?.[0]?.transport?.iceTransport;
        const pair = iceTransport?.getSelectedCandidatePair?.();
        ufrag = ufragMatch(pc.localDescription?.sdp);

        if (pair?.local && pair?.remote) {
          icePair = `${pair.local.type}-${pair.local.address}:${pair.local.port}/${pair.local.protocol} --> ${pair.remote.type}-${pair.remote.address}:${pair.remote.port}/${pair.remote.protocol}`;
        }
      }

      updateParticipant(participant.id, {
        iceConnectionState,
        icePair,
        lastIceStateChange: Date.now(),
        ufrag,
      });

      onStateChanged?.(pc.iceConnectionState);
    };

    pc.onicegatheringstatechange = () => {
      const iceGatheringState = pc.iceGatheringState;
      log('onicegatheringstatechange', formatId(participant.id), iceGatheringState);

      if (iceGatheringState === 'complete') {
        let icePair = undefined;
        let ufrag = undefined;

        const iceTransport = pc.getSenders()?.[0]?.transport?.iceTransport;
        const pair = iceTransport?.getSelectedCandidatePair?.();
        ufrag = ufragMatch(pc.localDescription?.sdp);

        if (pair?.local && pair?.remote) {
          icePair = `${pair.local.type}-${pair.local.address}:${pair.local.port}/${pair.local.protocol} --> ${pair.remote.type}-${pair.remote.address}:${pair.remote.port}/${pair.remote.protocol}`;
        }

        updateParticipant(participant.id, {
          iceGatheringState,
          lastIceGatheringStateChange: Date.now(),
          icePair,
          ufrag,
        });
      } else {
        updateParticipant(participant.id, {
          iceGatheringState,
          lastIceGatheringStateChange: Date.now(),
        });
      }
    };

    log('set signalHandler', formatId(participant.id));
    socket.on('message', signalHandler);

    let bytesPrevSent: number | undefined = undefined;
    let bytesPrevReceived: number | undefined = undefined;
    let bytesPrevAudioSent: number | undefined = undefined;
    let bytesPrevAudioReceived: number | undefined = undefined;
    let bytesPrevTime: number | undefined = undefined;
    let statUfrag: string | undefined = undefined;

    async function checkDataTransmission() {
      const actualParticipant = find(participant.id);

      if (!actualParticipant || actualParticipant.sessionId !== sessionId) {
        return;
      }

      if (
        pc.connectionState === 'disconnected' ||
        pc.connectionState === 'failed' ||
        pc.connectionState === 'closed'
      ) {
        if (
          bytesPrevSent
          || bytesPrevReceived
          || bytesPrevTime
        ) {
          bytesPrevSent = undefined;
          bytesPrevReceived = undefined;
          bytesPrevAudioSent = undefined;
          bytesPrevAudioReceived = undefined;
          bytesPrevTime = undefined;

          updateParticipant(participant.id, {
            bytesPrevSent,
            bytesPrevReceived,
            bytesPrevAudioSent,
            bytesPrevAudioReceived,
            bytesPrevTime,
          });
        }

        return;
      }

      if (statUfrag !== ufragMatch(pc.localDescription?.sdp)) {
        log('stats ufrag changed', statUfrag, ufragMatch(pc.localDescription?.sdp));

        statUfrag = ufragMatch(pc.localDescription?.sdp);
        bytesPrevSent = undefined;
        bytesPrevReceived = undefined;
        bytesPrevAudioSent = undefined;
        bytesPrevAudioReceived = undefined;
        bytesPrevTime = undefined;
      }

      const stats = await pc.getStats(null);
      const bytesTime = Date.now();
      let bytesSent = 0;
      let bytesReceived = 0;
      let bytesAudioSent = 0;
      let bytesAudioReceived = 0;

      stats.forEach(report => {
        if (report.type === 'outbound-rtp' && report.bytesSent) {
          bytesSent += report.bytesSent;

          if (report.mediaType === 'audio') {
            bytesAudioSent += report.bytesSent;
          }
        }
        if (report.type === 'inbound-rtp' && report.bytesReceived) {
          bytesReceived += report.bytesReceived;

          if (report.mediaType === 'audio') {
            bytesAudioReceived += report.bytesReceived;
          }
        }
      });

      updateParticipant(participant.id, {
        bytesSent,
        bytesReceived,
        bytesAudioSent,
        bytesAudioReceived,
        bytesTime,
        bytesPrevSent,
        bytesPrevReceived,
        bytesPrevAudioSent,
        bytesPrevAudioReceived,
        bytesPrevTime,
      }, false);

      bytesPrevSent = bytesSent;
      bytesPrevReceived = bytesReceived;
      bytesPrevAudioSent = bytesAudioSent;
      bytesPrevAudioReceived = bytesAudioReceived;
      bytesPrevTime = bytesTime;
    }

    // Постоянное обновление статистики так же вызывает механизм выявления
    // мертвого соединения. Не отключать!
    return {
      ...participant,
      heartbeatInterval: setupHeartbeat(participant.id, sessionId),
      sessionId,
      pc,
      signalHandler,
      statInterval: setInterval(checkDataTransmission, statsDelay),
      role: polite ? 'caller' : 'callee',
      state: 'calling',
      callStarted: Date.now(),
      config,
    };
  };

  function setupHeartbeat(pId: string, sessionId: string) {
    if (!sessionId) {
      throw new Error('Session ID not set');
    }

    const heartbeatInterval = setInterval(() => {
      if (socket?.connected) {
        emit({
          type: 'SOCKET_PING',
          payload: {
            fromId: participantId,
            toId: pId,
            sessionId,
          },
        });
      } else {
        const found = find(pId);
        if (found && found.socketPingRestored) {
          updateParticipant(pId, { socketPingRestored: undefined });
        }
      };
    }, heartbeatDelay);

    return heartbeatInterval;
  };

  function clearConnection(inP: Participant<S>) {
    const participant = { ...inP };

    log('clearConnection', formatId(participant.id));

    clearInterval(participant.heartbeatInterval);
    participant.heartbeatInterval = undefined;

    clearInterval(participant.statInterval);
    participant.statInterval = undefined;

    if (participant.signalHandler) {
      log('clearConnection -- off signalHandler', participant.id);
      socket?.off('message', participant.signalHandler);
      participant.signalHandler = undefined;
    }

    participant.stream?.getTracks().forEach(track => track.stop());
    participant.stream = undefined;

    if (participant.pc) {
      participant.pc.onicecandidate = null;
      participant.pc.oniceconnectionstatechange = null;
      participant.pc.onicegatheringstatechange = null;
      participant.pc.ontrack = null;
      participant.pc.onnegotiationneeded = null;
      participant.pc.close();
      participant.pc = undefined;
    }

    participant.state = 'initial';
    participant.audioEnabled = undefined;
    participant.videoEnabled = undefined;
    participant.connectionState = undefined;
    participant.iceConnectionState = undefined;
    participant.iceGatheringState = undefined;
    participant.icePair = undefined;
    participant.bytesSent = undefined;
    participant.bytesReceived = undefined;
    participant.bytesAudioSent = undefined;
    participant.bytesAudioReceived = undefined;
    participant.bytesTime = undefined;
    participant.bytesPrevSent = undefined;
    participant.bytesPrevReceived = undefined;
    participant.bytesPrevAudioSent = undefined;
    participant.bytesPrevAudioReceived = undefined;
    participant.bytesPrevTime = undefined;
    participant.role = undefined;
    participant.wasOk = undefined;
    participant.callStarted = undefined;
    participant.callResolved = undefined;
    participant.lastStateChange = undefined;
    participant.lastIceStateChange = undefined;
    participant.lastIceGatheringStateChange = undefined;
    participant.config = undefined;
    participant.ufrag = undefined;
    participant.videoReadyState = undefined;
    participant.socketPingReceived = undefined;
    participant.socketPingRestored = undefined;
    participant.problemDiscovered = undefined;
    participant.preProblemDiscovered = undefined;
    participant.unrecoverableError = undefined;
    participant.sessionId = undefined;
    participant.restartIceTried = undefined;
    participant.error = undefined;

    return participant;
  }

  onMessageRef.current = (message: Message<S, M, D>) => {
    if (!socket) {
      return;
    }
    if (!config) {
      return;
    }

    if (message.type !== 'SOCKET_DISCONNECTED') {
      if (message.payload.fromId === participantId) {
        return;
      }

      if (isAddressedMessage(message) && message.payload.toId !== participantId) {
        return;
      }
    }

    if (
      message.type !== 'SOCKET_PING' &&
      message.type !== 'SOCKET_PONG' &&
      message.type !== 'SIGNAL'
    ) {
      if (isAddressedMessage(message)) {
        log(
          'onMessage',
          message.type,
          formatId(message.payload.fromId),
          '-->',
          formatId(message.payload.toId)
        );
      } else if (isBroadcastMessage(message)) {
        log('onMessage', message.type, formatId(message.payload.fromId));
      } else if (Object.hasOwn(message.payload, 'id')) {
        log('onMessage', message.type, formatId((message.payload as any).id));
      }
    }

    switch (message.type) {
      case 'JOIN':
        const found = find(message.payload.fromId);

        if (found) {
          updateParticipant(message.payload.fromId, p => ({
            ...p,
            name: message.payload.name,
            state:
              (p.state === 'initial' || p.state === 'ready' || p.state === 'error') &&
                (message.payload.state === 'initial' || message.payload.state === 'ready')
                ? message.payload.state
                : p.state,
            error: p.state === 'error' &&
              (message.payload.state === 'initial' || message.payload.state === 'ready')
              ? undefined
              : p.error,
            audioEnabled: message.payload.audioEnabled,
            videoEnabled: message.payload.videoEnabled,
            participantState: message.payload.participantState
          }));
        } else {
          assignParticipants([
            ...participantsRef.current,
            {
              id: message.payload.fromId,
              name: message.payload.name,
              state: message.payload.state,
              audioEnabled: message.payload.audioEnabled,
              videoEnabled: message.payload.videoEnabled,
              participantState: message.payload.participantState,
            },
          ]);
        }
        break;

      case 'LEAVE':
        const participantLeft = find(message.payload.fromId);
        if (participantLeft) {
          clearConnection(participantLeft);
          assignParticipants(filter(p => p.id !== message.payload.fromId));
        }
        break;

      case 'SOCKET_DISCONNECTED':
        const participant = find(message.payload.participantId);
        if (
          participant &&
          !participant.pc &&
          (participant.state === 'initial' || participant.state === 'ready')
        ) {
          clearConnection(participant);
          assignParticipants(filter(p => p.id !== message.payload.participantId));
        }
        break;

      case 'END_CALL':
        if (find(message.payload.fromId)) {
          updateParticipant(message.payload.fromId, clearConnection);
          emit({
            type: 'ENUM',
            payload: {
              fromId: participantId,
            },
          });
        }
        break;

      case 'RESTART_CALL':
        {
          const participant = find(message.payload.fromId);
          if (
            participant &&
            participant.state === 'in-call' &&
            participant.pc &&
            participant.role === 'caller'
          ) {
            restartCall(participant);
          }
        }
        break;

      case 'ENUM':
        emit({
          type: 'JOIN',
          payload: {
            fromId: participantId,
            name: participantName,
            state: localStreamRef.current !== null ? 'ready' : 'initial',
            audioEnabled: isAudioEnabled(),
            videoEnabled: isVideoEnabled(),
            participantState
          },
        });
        break;

      case 'MAKE_CALL':
        {
          const callee = find(message.payload.calleeId);

          if (callee && callee.state === 'ready' && localStream) {
            makeCall(callee, true);
          }
        }
        break;

      case 'SOCKET_PING':
        emit({
          type: 'SOCKET_PONG',
          payload: {
            fromId: participantId,
            toId: message.payload.fromId,
            sessionId: message.payload.sessionId,
          },
        });
        break;

      case 'SOCKET_PONG':
        {
          const participant = find(message.payload.fromId);

          if (participant?.sessionId !== message.payload.sessionId) {
            console.warn(
              'SOCKET_PONG -- session ID mismatch',
              participant?.sessionId,
              message.payload.sessionId
            );
            return;
          }

          if (
            participant &&
            participant.heartbeatInterval &&
            participant.sessionId === message.payload.sessionId
          ) {
            const found = find(message.payload.fromId);

            if (found) {
              updateParticipant(message.payload.fromId, {
                socketPingReceived: Date.now(),
                socketPingRestored: found.socketPingRestored ?? Date.now(),
              }, found.socketPingReceived === undefined);
            }
          }
        }
        break;

      case 'CALLING':
        {
          const participant = find(message.payload.fromId);

          if (participant) {
            log('CALLING -- createPerfect', participant.id);

            let negotiatedParticipant: Participant<S> | undefined;

            updateParticipant(participant.id, p => {
              negotiatedParticipant = createPerfectNegotiation(
                clearConnection(p),
                normalizeWebRTCConfig(message.payload.config),
                false,
                message.payload.sessionId
              );
              return negotiatedParticipant;
            });

            if (
              !negotiatedParticipant?.pc ||
              negotiatedParticipant.sessionId !== message.payload.sessionId ||
              negotiatedParticipant.state === 'error'
            ) {
              return;
            }

            emit({
              type: 'ANSWER_CALL',
              payload: {
                fromId: participantId,
                toId: participant.id,
                sessionId: message.payload.sessionId,
                audioEnabled: isAudioEnabled(),
                videoEnabled: isVideoEnabled(),
              },
            });
          } else {
            console.warn('CALLING -- participant not found', message.payload.fromId);
          }
        }
        break;

      case 'ANSWER_CALL':
        {
          const participant = find(message.payload.fromId);

          if (participant?.sessionId !== message.payload.sessionId) {
            console.warn(
              'ANSWER_CALL -- session ID mismatch',
              participant?.sessionId,
              message.payload.sessionId
            );
            return;
          }

          if (participant && participant.state === 'calling') {
            if (!participant.pc) {
              setError('Peer connection is not established');
              return;
            }

            startConnection(participant, message.payload.audioEnabled, message.payload.videoEnabled);

            emit({
              type: 'ANSWER_CALL',
              payload: {
                fromId: participantId,
                toId: participant.id,
                sessionId: message.payload.sessionId,
                audioEnabled: isAudioEnabled(),
                videoEnabled: isVideoEnabled(),
              },
            });
          }
        }

        break;

      case 'CUSTOM_MESSAGE':
        eventEmitterRef.current.emit('CUSTOM_MESSAGE', message);
        break;
    }
  };

  useEffect(() => {
    if (!participantId || !peerServerUrl || !homeUrl || !socketPath) {
      return;
    }

    const correctedRoomId = 'video:' + roomId;

    const socket = io(peerServerUrl, {
      query: {
        roomId: correctedRoomId,
        participantId,
        instanceId,
      },
      path: socketPath,
      autoConnect: false,
    });

    function onConnect() {
      log('socket connected');
      setSocketStatus('connected');
      setLastSocketConnected(Date.now());
    }

    function onDisconnect() {
      log('socket disconnected');
      setSocketStatus('disconnected');
      setLastSocketConnected(undefined);
    }

    function onMessage(message: Message<S, M, D>) {
      onMessageRef.current?.(message);
    }

    function onAlreadyInRoom() {
      alreadyInRoomRef.current = true;
      setAlreadyInRoom(true);
    }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('message', onMessage);
    socket.on('already_in_room', onAlreadyInRoom);

    socket.connect();

    setSocket(socket);

    function unload() {
      if (!alreadyInRoomRef.current) {
        navigator.sendBeacon(
          `${homeUrl}/user_closing_tab?participantId=${encodeURIComponent(participantId)}&roomId=${encodeURIComponent(correctedRoomId)}`,
        );
      }
    }

    window.addEventListener('unload', unload);

    return () => {
      window.removeEventListener('unload', unload);
      socket.removeAllListeners();
      socket.emit('message', {
        type: 'LEAVE',
        payload: {
          fromId: participantId,
        },
      });
      socket.disconnect();
    };
  }, [homeUrl, instanceId, participantId, peerServerUrl, roomId, socketPath]);

  useEffect(() => {
    if (socketStatus === 'connected' && socket) {
      emit({
        type: 'ENUM',
        payload: {
          fromId: participantId,
        },
      });
    }
  }, [participantId, socketStatus, socket]);

  useEffect(() => {
    if (socketStatus === 'connected' && socket) {
      emit({
        type: 'JOIN',
        payload: {
          fromId: participantId,
          name: participantName,
          state: localStream ? 'ready' : 'initial',
          audioEnabled: isAudioEnabled(),
          videoEnabled: isVideoEnabled(),
          participantState
        },
      });
    }
  }, [participantId, participantName, participantState, socketStatus, socket, localStream]);

  useEffect(() => {
    if (ownRef.current) {
      ownRef.current!.srcObject = localStream;
    }
  }, [localStream, ownRef.current]);

  const stopMediaStream = useCallback(() => {
    if (localStream) {
      localStream.getTracks().forEach(track => {
        track.stop();
      });
      ownRef.current!.srcObject = null;
      localStreamRef.current = null;
      setLocalStream(null);
      emit({
        type: 'JOIN',
        payload: {
          fromId: participantId,
          name: participantName,
          state: 'initial',
          participantState
        },
      });
    }
  }, [participantId, participantName, participantState, emit]);

  const canRestartIce = useCallback((participant: Participant<S>) =>
    participant.state === 'in-call' &&
    !!participant.pc &&
    //&& participant.iceGatheringState !== 'gathering'
    participant.iceConnectionState !== 'checking' &&
    participant.connectionState !== 'connecting',
    []
  );

  const restartIce = useCallback((participant: Participant<S>) =>
    canRestartIce(participant) && participant.pc?.restartIce(), [canRestartIce]);

  const setVideoReadyState = useCallback((pId: string, state: number | undefined) => {
    const participant = find(pId);
    if (participant && participant.videoReadyState !== state) {
      updateParticipant(pId, { videoReadyState: state });
    }
  }, []);

  const clearError = useCallback(() => setError(''), []);

  const getParticipant = useCallback((pId: string) => find(pId), []);

  const forceUpdate = useCallback(() => {
    setParticipants([...participantsRef.current]);
  }, []);

  const enableTrack = useCallback((track: 'audio' | 'video', enabled: boolean) => {
    if (!localStreamRef.current) {
      return;
    }

    let changed = false;

    localStreamRef.current.getTracks().forEach(t => {
      if (t.kind === track && t.enabled !== enabled) {
        t.enabled = enabled;
        changed = true;
      }
    });

    if (changed) {
      emit({
        type: 'JOIN',
        payload: {
          fromId: participantId,
          name: participantName,
          state: 'ready',
          audioEnabled: isAudioEnabled(),
          videoEnabled: isVideoEnabled(),
          participantState
        },
      });
    }
  }, [participantName, participantId, participantState, isAudioEnabled, isVideoEnabled, emit]);

  const switchTrack = useCallback(async (track: 'audio' | 'video', newStream: MediaStream) => {
    const newTrack = track === 'video' ? newStream.getVideoTracks()[0] : newStream.getAudioTracks()[0];

    for (const p of participantsRef.current) {
      if (p.state === 'in-call' && p.pc) {
        const sender = p.pc.getSenders().find(s => s.track?.kind === newTrack.kind);
        if (sender) {
          await sender.replaceTrack(newTrack);
        }
      }
    }

    localStreamRef.current = newStream;
    setLocalStream(newStream);
  }, []);

  return {
    participantName,
    participantState,
    setParticipantName,
    setParticipantState,
    localStream,
    setLocalStream,
    enableTrack,
    setVideoReadyState,
    config,
    setConfig,
    participants,
    socket,
    socketStatus,
    makeCall,
    endCall,
    restartCall,
    restartIce,
    canRestartIce,
    sendMessage,
    subscribe,
    unsubscribe,
    clearParticipantError,
    error,
    configError: configError || connectionError,
    configLoading,
    clearError,
    alreadyInRoom,
    getParticipant,
    forceUpdate,
    switchTrack,
  };
}
