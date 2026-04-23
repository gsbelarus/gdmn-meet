import { Dispatch, SetStateAction } from 'react';

export type SocketStatus = 'connected' | 'disconnected' | 'initial';

export type BroadcastMessage = {
  type: 'LEAVE' | 'ENUM';
  payload: {
    fromId: string;
  };
};

export type JoinMessage<S> = {
  type: 'JOIN';
  payload: {
    fromId: string;
    name: string;
    state: StateInCall;
    audioEnabled?: boolean;
    videoEnabled?: boolean;
    participantState?: S;
  };
};

export type AddressedMessage = {
  type: 'SOCKET_PING' | 'SOCKET_PONG' | 'END_CALL' | 'RESTART_CALL';
  payload: {
    fromId: string;
    toId: string;
    sessionId: string;
  };
};

export type AnswerCallMessage = {
  type: 'ANSWER_CALL';
  payload: {
    fromId: string;
    toId: string;
    sessionId: string;
    audioEnabled: boolean;
    videoEnabled: boolean;
  };
};

export type CallingMessage = {
  type: 'CALLING';
  payload: {
    fromId: string;
    toId: string;
    sessionId: string;
    config: WebRTCConfig;
  };
};

export type MakeCallMessage = {
  type: 'MAKE_CALL';
  payload: {
    fromId: string;
    toId: string;
    calleeId: string;
  };
};

export type CustomMessage<M, D = undefined> = {
  type: 'CUSTOM_MESSAGE';
  payload: {
    fromId: string;
    toId: string | undefined | null;
    data: M;
    metadata?: D;
  };
};

export type Signal = {
  type: 'SIGNAL';
  payload: {
    fromId: string;
    toId: string;
    sessionId: string;
    candidate?: RTCIceCandidate;
    description?: RTCSessionDescriptionInit | null;
  };
};

export type SocketDisconnectedMessage = {
  type: 'SOCKET_DISCONNECTED';
  payload: {
    roomId: string;
    participantId: string;
  };
};

export type Message<S, M, D> =
  | JoinMessage<S>
  | BroadcastMessage
  | CallingMessage
  | SocketDisconnectedMessage
  | AddressedMessage
  | AnswerCallMessage
  | MakeCallMessage
  | CustomMessage<M, D>
  | Signal;

export function isBroadcastMessage<S, M, D>(message: Message<S, M, D>): message is BroadcastMessage {
  return (
    Object.hasOwn(message, 'payload') &&
    Object.hasOwn(message.payload, 'fromId') &&
    !Object.hasOwn(message.payload, 'toId')
  );
}

export function isAddressedMessage<S, M, D>(message: Message<S, M, D>): message is AddressedMessage {
  return (
    Object.hasOwn(message, 'payload') &&
    Object.hasOwn(message.payload, 'fromId') &&
    Object.hasOwn(message.payload, 'toId')
  );
}

export type MessageHandler<S, M, D> = ((message: Message<S, M, D>) => void) | ((message: Signal) => Promise<void>);

export type StateInCall = 'initial' | 'ready' | 'calling' | 'in-call' | 'error';

export type Participant<S> = {
  /**
   * ID of the participant. Must be unique in the room.
   */
  id: string;
  /**
   * Arbitrary name of the participant.
   * It is not required to be unique.
   */
  name: string;
  /**
   * State of the participant.
   */
  participantState?: S;
  /**
   * State of the participant in the call.
   * - initial: just joined the room. Can change to ready or error.
   * - ready: ready to make a call, i.e. camera and microphone are ready.
   * - calling: in the process of making a call
   * - in-call: in the call. Does not mean that the WebRTC connection is well and data flows.
   * - error: something went wrong, See the error field for details.
   */
  state: StateInCall;
  /**
   * True if the audio track is enabled on the participant side.
   */
  audioEnabled?: boolean;
  /**
   * True if the video track is enabled on the participant side.
   */
  videoEnabled?: boolean;
  /**
   * Connection state of the WebRTC connection.
   */
  connectionState?: 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';
  /**
   * ICE connection state of the WebRTC connection.
   */
  iceConnectionState?: 'new' | 'checking' | 'connected' | 'completed' | 'failed' | 'disconnected' | 'closed';
  /**
   * ICE gathering state of the WebRTC connection.
   */
  iceGatheringState?: 'new' | 'gathering' | 'complete';
  /**
   * WebRTC peer connection. Appears when the call changes to the 'in-call' state.
   */
  pc?: RTCPeerConnection | null;
  /**
   * Stream from the Peer connection. Set when track.onunmute event is fired.
   */
  stream?: MediaStream | null;
  /**
   * Handler of the signal message. Used internally for maintaining the WebRTC connection.
   */
  signalHandler?: (message: Signal) => Promise<void>;
  /**
   * ICE pair of the connection. Appears when the ICE connection state changes to 'connected'.
   * Changes when the ICE onicegatherinstatechange changes to 'complete'.
   */
  icePair?: string;
  /**
   * Total bytes sent from the participant.
   */
  bytesSent?: number;
  /**
   * Total bytes received by the participant.
   */
  bytesReceived?: number;
  /**
   * Total bytes sent from the participant through the audio track.
   */
  bytesAudioSent?: number;
  /**
   * Total bytes received by the participant through the audio track.
   */
  bytesAudioReceived?: number;
  /**
   * Time when bytes statistics were gathered.
   */
  bytesTime?: number;
  /**
   * Previous total bytes sent from the participant.
   * Used for calculating the connection speed.
   */
  bytesPrevSent?: number;
  /**
   * Previous total bytes received by the participant.
   * Used for calculating the connection speed.
   */
  bytesPrevReceived?: number;
  /**
   * Previous total bytes sent from the participant through the audio track.
   * Used for calculating the connection speed.
   */
  bytesPrevAudioSent?: number;
  /**
   * Previous total bytes received by the participant through the audio track.
   * Used for calculating the connection speed.
   */
  bytesPrevAudioReceived?: number;
  /**
   * Time when previous bytes statistics were gathered.
   */
  bytesPrevTime?: number;
  /**
   * Data channel for the heartbeat. Used for maintaining the WebRTC connection.
   */
  //dataChannel?: RTCDataChannel;
  /**
   * Time when the last heartbeat was received.
   */
  //heartbeatReceived?: number;
  /**
   * Interval for sending the heartbeat.
   * Maintained internally. Cleared when the connection is done or hook is unmounted.
   */
  heartbeatInterval?: NodeJS.Timeout;
  /**
   * Interval for gathering the statistics.
   * Maintained internally. Cleared when the connection is done or hook is unmounted.
   */
  statInterval?: NodeJS.Timeout;
  /**
   * Our role in the call with the participant.
   * - caller: we have iniciated the call with the participant.
   * - callee: the participant iniciated the call.
   */
  role?: 'caller' | 'callee';
  /**
   * Flag to indicate that the call was established and data is flowing
   * or has flowed for at least a minimal amount of time.
   */
  wasOk?: boolean;
  /**
   * Time when the call was started.
   */
  callStarted?: number;
  /**
   * Time when the call was resolved after the connection was interrupted.
   */
  callResolved?: number;
  /**
   * Time when the connection state was changed.
   */
  lastStateChange?: number;
  /**
   * Time when the ICE connection state was changed.
   */
  lastIceStateChange?: number;
  /**
   * Time when the ICE gathering state was changed.
   */
  lastIceGatheringStateChange?: number;
  /**
   * Configuration of the WebRTC connection used for the call.
   */
  config?: WebRTCConfig;
  /**
   * ICE username fragment. Used for the statistics.
   */
  ufrag?: string;
  /**
   * Video ready state provided by the video element using a call-back function.
   */
  videoReadyState?: number;
  /**
   * Last time when the PING-PONG message was received through the Web Socket.
   */
  socketPingReceived?: number;
  /**
   * The time the PING-PONG sequence was recieved after socket heartbeats were missed.
   */
  socketPingRestored?: number;
  /**
   * The time the problem discovered first time. We let the connection to recover for a while.
   */
  preProblemDiscovered?: number;
  /**
   * Time when the problem with the connection was discovered.
   */
  problemDiscovered?: number;
  /**
   * The technical problem is on the callee side.
   */
  //calleeProblem?: boolean;
  /**
   * When had the callee problem been received.
   * Also undefined when there is no problem on the callee side.
   */
  //calleeProblemRecieved?: number;
  /**
   * Some error on the WebRTC side. Often due to incompatabilities between the browsers.
   * Requires a restart of the call.
   */
  unrecoverableError?: boolean;
  /**
   * Session ID of the call. It changes when the peer connection is re-established during
   * the call due to an unrecoverable error or when the restart procedure takes longer than allowed.
   */
  sessionId?: string;
  /**
   * restartIce() was called. Used to prevent multiple calls.
   */
  restartIceTried?: number;
  /**
   * Error message. Appears when the state is 'error'.
   */
  error?: string;
  /**
   * Last registered health check timestamp.
   */
  healthCheck?: number;
};

export type ParticipantH = {
  /**
   * ID of the participant. Must be unique in the room.
   */
  id: string;
  /**
   * Arbitrary name of the participant.
   * It is not required to be unique.
   */
  name: string;
  /**
   * State of the participant
   * - initial: just joined the room. Can change to ready or error.
   * - ready: ready to make a call, i.e. camera and microphone are ready.
   * - calling: in the process of making a call
   * - in-call: in the call. Does not mean that the WebRTC connection is well and data flows.
   * - error: something went wrong, See the error field for details.
   */
  state: StateInCall;
  /**
   * True if the WebRTC connection is stable and video is flowing.
   * Makes sense only when the state is 'in-call'.
   */
  problemDiscovered?: number;
  /**
   * Stream from the Peer connection. Set when track.onunmute event is fired.
   */
  stream?: MediaStream | null;
  /**
   * Our role in the call with the participant.
   * - caller: we have iniciated the call with the participant.
   * - callee: the participant iniciated the call.
   */
  role?: "caller" | "callee";
  /**
   * Error message. Appears when the state is 'error'.
   */
  error?: string;
};

export type SetVideoReadyState = (pId: string, state: number | undefined) => void;

type iceServer = {
  urls: string[],
  username?: string,
  credential?: string
}

type ICEPolicy = 'all' | 'relay';

export type WebRTCConfig = {
  stun: iceServer[];  // список объектов STUN серверов через запятую
  turn: iceServer[];  // список объектов TURN серверов через запятую
  icePolicy: ICEPolicy;
};

export type UseVideoCallProps<S> = {
  /**
   * Home server URI
   */
  homeUrl: string,
  /**
   * Peer server URI
   */
  peerServerUrl: string,
  /**
   * Socket path to connect
   */
  socketPath: string,
  /**
   * Room ID. Participants see each other only in the same room.
   */
  roomId: string;
  /**
   * ID of the participant. Must be unique in the room.
   */
  participantId: string;
  /**
   * Arbitrary name of the participant.
   * It is not required to be unique.
   */
  participantName: string;
  /**
   * State of the participant.
   */
  participantState?: S;
  /**
   * WebRTC configuration for the connection.
   * If not provided, the default configuration is used.
   */
  config?: WebRTCConfig;
  /**
   * Organization ID for loading dynamic WebRTC configuration.
   * If provided, will use ServiceManager to load TURN/STUN servers.
   */
  organizationId?: string | null;
};

export type UseVideoCallHReturn = {
  /**
   * Function allows to change the name of the participant after the hook is initialized.
   */
  setParticipantName: Dispatch<SetStateAction<string>>,
  /**
   * Local stream of the participant.
   */
  localStream: MediaStream | null,
  /**
   * Function to set the local stream.
   */
  setLocalStream: Dispatch<SetStateAction<MediaStream | null>>,
  /**
   * Callback function to set the video ready state of the participant.
   * Used for the video element to detect when the video is ready to play.
   */
  setVideoReadyState: SetVideoReadyState,
  /**
   * Socket status of the connection.
   */
  socketStatus: SocketStatus,
  /**
   * List of participants in the room.
   */
  participants: ParticipantH[],
  /**
   * Function to make a call to the participant.
   */
  makeCall: (participant?: ParticipantH) => Promise<void>,
  /**
   * Function to end the call with the participant.
   */
  endCall: (participant: ParticipantH, error?: string) => void,
  /**
   * Function to clear the error of the participant.
   */
  clearParticipantError: (participant: ParticipantH) => void,
  /**
   * Error state of the hook. Don't confuse with the error state of the participant.
   */
  error: string,
  /**
   * Function to set the error state of the hook.
   */
  clearError: () => void,
  /**
   * State of the transport connection has changed.
   */
  //connectionChanged: (connected: boolean) => void,
};

export const compareParticipants = (a: ParticipantH, b: ParticipantH) =>
  a.id === b.id
  && a.name === b.name
  && a.state === b.state
  && a.stream === b.stream
  && a.role === b.role
  && a.error === b.error;

export const formatId = (id?: string) => (id?.length === 36 ? id.slice(-4) : id);
