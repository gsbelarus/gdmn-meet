![GDMN Meet](doc/title_image.png)

# GDMN Meet. Privacy-first peer-to-peer video meetings

Video meeting application. Deploy the app and signalling server under hostnames you control. For technical details, read the article [Building a Resilient WebRTC Video Call](doc/webrtc-video-call-architecture.md).

Try it out: [meet.gdmn.app](https://meet.gdmn.app)

## What is inside

- Single-project Next.js app
- Separate Socket.IO signalling server started from `server.ts`
- WebRTC ICE config loaded from a JSON file mounted from outside the app
- Docker support for cloud deployment

## Runtime domains

For production, choose two public HTTPS URLs you control:

- App: the public URL where users open the Next.js client, for example `https://video.example.com`
- Signalling socket: the public URL that fronts the Socket.IO server, for example `https://signal.video.example.com`

Use those same URLs consistently in your environment variables and reverse proxy configuration.

## Required environment variables

Create a `.env.local` for local development or pass the same values from your process manager / container runtime:

```env
PORT=3000
PEER_PORT=4000
HOSTNAME=0.0.0.0
NEXT_PUBLIC_HOME=http://localhost:3000
NEXT_PUBLIC_WSS_PEER_URI=http://localhost:4000
NEXT_PUBLIC_SPACE=/socket.io
WEBRTC_CONFIG_PATH=./config/webrtc.config.json
```

Production values should use your own public URLs:

```env
PORT=3000
PEER_PORT=4000
HOSTNAME=0.0.0.0
NEXT_PUBLIC_HOME=https://video.example.com
NEXT_PUBLIC_WSS_PEER_URI=https://signal.video.example.com
NEXT_PUBLIC_SPACE=/socket.io
WEBRTC_CONFIG_PATH=./config/webrtc.config.json
```

## Sample files

Files that end with `.sample` are templates. Before you run the app or prepare a deployment, rename or copy the template you need and replace every placeholder with real values for your environment.

- `config/webrtc.config.json.sample` -> `config/webrtc.config.json`
- If you use `Dockerfile.sample` as a deployment template, copy it to your own Dockerfile and replace the example hostnames and other placeholder values.

In particular, do not keep example TURN/STUN servers, usernames, credentials, or public URLs from the sample files.

## ICE config file

The app reads STUN/TURN settings from `WEBRTC_CONFIG_PATH`. By default that is:

```text
./config/webrtc.config.json
```

You can replace the bundled file, or better, mount your own file there. The required format is:

```json
{
  "stun": [
    {
      "urls": ["stun:example.org:3478"]
    }
  ],
  "turn": [
    {
      "urls": ["turns:example.org:443"],
      "username": "user",
      "credential": "secret"
    }
  ],
  "icePolicy": "all"
}
```

## Local development

Install dependencies:

```bash
npm install
```

Run the app and signalling server together:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Production build

```bash
npm run build
npm run start
```

This starts:

- Next.js app server on `PORT`
- Socket.IO signalling server on `PEER_PORT`

## Docker

Build the image:

```bash
docker build -t gdmn-meet .
```

Run the container with the ICE config mounted from the host:

```bash
docker run -d \
  --name gdmn-meet \
  -p 3000:3000 \
  -p 4000:4000 \
  -e NEXT_PUBLIC_HOME=https://video.example.com \
  -e NEXT_PUBLIC_WSS_PEER_URI=https://signal.video.example.com \
  -e NEXT_PUBLIC_SPACE=/socket.io \
  -e WEBRTC_CONFIG_PATH=/app/config/webrtc.config.json \
  -v /srv/gdmn-meet/webrtc.config.json:/app/config/webrtc.config.json:ro \
  gdmn-meet
```

Replace `https://video.example.com` and `https://signal.video.example.com` with the public URLs you chose for your deployment.

## Reverse proxy

Expose the container behind the same public URLs you configured above:

- app URL (`NEXT_PUBLIC_HOME`) -> container port `3000`
- signalling URL (`NEXT_PUBLIC_WSS_PEER_URI`) -> container port `4000`

Make sure WebSocket upgrades are enabled for the signalling server URL.

## Notes

- The signalling socket path is controlled by `NEXT_PUBLIC_SPACE`.
- The app reads the ICE config at request time, so replacing the mounted JSON file does not require rebuilding the image.
