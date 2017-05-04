const URL = window.URL || window.webkitURL || window.mozURL || window.msURL;
const RTCPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
const RTCSessionDescription = window.RTCSessionDescription || window.mozRTCSessionDescription;
const RTCIceCandidate = window.RTCIceCandidate || window.mozRTCIceCandidate;

const availableDevices = {
  cam: null,
  mic: null,
};
if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
  navigator.mediaDevices.enumerateDevices().then((devices) => {
    devices.forEach((device) => {
      if (device.kind === 'videoinput' || device.kind === 'video') {
        availableDevices.cam = true;
      }
      if (device.kind === 'audioinput' || device.kind === 'audio') {
        availableDevices.mic = true;
      }
    });
  });
  if (availableDevices.cam === null) {
    availableDevices.cam = false;
  }
  if (availableDevices.mic === null) {
    availableDevices.mic = false;
  }
} else {
  availableDevices.cam = true;
  availableDevices.mic = true;
}

const protocolSupport = document.location.protocol === 'https:' || document.location.hostname === 'localhost';
const supported = !!(URL && URL.createObjectURL && RTCPeerConnection && protocolSupport);

class WebRTC {
  static getStreamUrl(stream) {
    let url;
    try {
      url = URL.createObjectURL(stream) || stream;
    } catch (e) {
      url = stream;
    }
    return url;
  }

  static stopStream(stream) {
    if (stream) {
      if (stream.stop) {
        stream.stop();
      }
      if (stream.getVideoTracks && stream.getVideoTracks()[0]) {
        stream.getVideoTracks()[0].enabled = false;
      }
      if (stream.getAudioTracks && stream.getAudioTracks()[0]) {
        stream.getAudioTracks()[0].enabled = false;
      }
      if (stream.getTracks) {
        const tracks = stream.getTracks();
        tracks.forEach((track) => {
          if (track && track.stop) {
            track.stop();
          }
        });
      }
    }
  }

  static guid() {
    function s4() {
      return Math.floor((1 + Math.random()) * 0x10000)
        .toString(16)
        .substring(1);
    }

    return s4() + s4() + s4();
  }

  constructor(props) {
    if (!props || typeof props !== 'object' || !props.endpoint || !props.room) {
      throw new Error('Specify endpoint and room in constructor');
    }

    this.endpoint = props.endpoint;
    this.room = props.room;
    this.roomType = props.roomType;
    this.master = this.roomType === WebRTC.ROOM_TYPE_1_TO_N && props.master;
    this.id = props.id || WebRTC.guid();
    this.remotes = [];
    this.listeners = {};
    this.localStream = props.localStream;
    this.destroyed = false;
    this.mediaConstraints = {
      mandatory: {
        OfferToReceiveAudio: true,
        OfferToReceiveVideo: true,
      },
    };
    this.socket = new WebSocket(this.endpoint);
    this.socket.onopen = () => {
      this.signal('join', {
        id: this.id,
        room: this.room,
        type: this.roomType,
        master: this.master,
      });
      this.trigger(WebRTC.EVENT_START);
    };
    this.socket.onclose = () => {
      this.trigger(WebRTC.EVENT_END);
    };
    this.socket.onerror = (err) => {
      this.trigger(WebRTC.EVENT_ERROR, err);
    };
    this.socket.onmessage = (message) => {
      let msg;
      try {
        msg = JSON.parse(message.data);
      } catch (e) {
        this.trigger(WebRTC.EVENT_ERROR, new Error(`Parsing signaling server message: ${message.data}`));
        return;
      }
      const localName = `signal${msg.fn.substr(0, 1).toUpperCase() + msg.fn.substr(1)}`;
      if (this[localName]) {
        this[localName](msg.id, msg.payload);
      }
      this.trigger(WebRTC.EVENT_SIGNAL_MESSAGE, msg);
    };
  }

  hangup() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.trigger(WebRTC.EVENT_END);
    WebRTC.stopStream(this.localStream);
    this.remotes.forEach((remote) => {
      if (remote && remote.connection && remote.connection.stream) {
        WebRTC.stopStream(remote.connection.stream);
      }
    });
    this.signal('leave');
    const socket = this.socket;
    this.listeners = {};
    this.socket = null;
    setTimeout(() => {
      socket.close();
    }, 1000);
  }

  signalJoin(senderId) {
    if (senderId === this.id) {
      return;
    }
    const existing = this.remotes.find(remote => remote.id === senderId);
    if (!existing) {
      const remote = { id: senderId, connection: null };
      this.remotes.push(remote);
      this.addPeerConnection(senderId);
      remote.connection.createOffer((sessionDescription) => {
        this.signal('offer', {
          target: senderId,
          payload: sessionDescription,
        });
        remote.connection.setLocalDescription(sessionDescription);
      }, (err) => {
        this.trigger(WebRTC.EVENT_ERROR, err);
      }, this.mediaConstraints);
    }
  }

  signalLeave(senderId) {
    const remoteIndex = this.remotes.findIndex(remote => remote.id === senderId);
    if (remoteIndex !== -1) {
      this.remotes.splice(remoteIndex, 1);
    }
  }

  signalIceCandidate(senderId, iceCandidate) {
    const existing = this.remotes.find(remote => remote.id === senderId);
    if (iceCandidate.candidate && existing && existing.id === senderId) {
      existing.connection.addIceCandidate(new RTCIceCandidate({
        sdpMLineIndex: iceCandidate.label,
        candidate: iceCandidate.candidate,
      }));
    }
  }

  signalOffer(senderId, offer) {
    const remoteIndex = this.remotes.findIndex(remote => remote.id === senderId);
    if (remoteIndex !== -1) {
      this.remotes.splice(remoteIndex, 1);
    }
    const remote = { id: senderId, connection: null };
    this.remotes.push(remote);
    this.addPeerConnection(senderId);
    remote.connection.setRemoteDescription(new RTCSessionDescription(offer));
    remote.connection.createAnswer((sessionDescription) => {
      remote.connection.setLocalDescription(sessionDescription);
      this.signal('answer', {
        target: senderId,
        payload: sessionDescription,
      });
    }, (err) => {
      this.trigger(WebRTC.EVENT_ERROR, err);
    }, this.mediaConstraints);
  }

  signalAnswer(senderId, answer) {
    const existing = this.remotes.find(remote => remote.id === senderId);
    if (existing) {
      existing.connection.setRemoteDescription(new RTCSessionDescription(answer));
    }
  }

  addPeerConnection(senderId) {
    const existing = this.remotes.find(remote => remote.id === senderId);
    if (existing) {
      const pc = new RTCPeerConnection({ iceServers: WebRTC.iceServers }, this.mediaConstraints);
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          this.signal('iceCandidate',
            {
              payload: {
                type: 'candidate',
                label: event.candidate.sdpMLineIndex,
                id: event.candidate.sdpMid,
                candidate: event.candidate.candidate,
              },
              target: senderId,
            });
        }
      };
      pc.onaddstream = (event) => {
        if (!pc.stream) {
          pc.stream = event.stream;
          this.trigger(WebRTC.EVENT_CONNECTED, event.stream);
        }
      };
      pc.ontrack = (event) => {
        if (!pc.stream) {
          pc.stream = event.streams[0];
          this.trigger(WebRTC.EVENT_CONNECTED, event.streams[0]);
        }
      };
      pc.onremovestream = () => {
        if (existing) {
          existing.connection = null;
          existing.remoteStreamURL = null;
        }
      };
      if (this.localStream) {
        pc.addStream(this.localStream);
      }
      pc.streamURL = '';
      pc.stream = '';
      existing.connection = pc;
      this.trigger(WebRTC.EVENT_FOUND_REMOTE);
    }
  }

  addListener(event, cb) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(cb);
  }

  trigger(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach((cb) => {
        cb(data);
      });
    }
  }

  signal(fn, data) {
    this.trigger(WebRTC.EVENT_SIGNAL_SEND, { fn, data });
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({
        fn,
        data,
      }));
    }
  }
}

WebRTC.ROOM_TYPE_N_TO_N = 'n-to-n';
WebRTC.ROOM_TYPE_1_TO_N = '1-to-n';

WebRTC.EVENT_START = 'start';
WebRTC.EVENT_END = 'end';
WebRTC.EVENT_ERROR = 'error';
WebRTC.EVENT_SIGNAL_MESSAGE = 'signalMessage';
WebRTC.EVENT_SIGNAL_SEND = 'signalSend';
WebRTC.EVENT_CONNECTED = 'connected';
WebRTC.EVENT_FOUND_REMOTE = 'foundRemote';
WebRTC.availableDevices = availableDevices;
WebRTC.supported = supported;
WebRTC.iceServers = [
  {
    urls: 'stun:148.251.126.74:5349',
  },
  {
    urls: 'turn:148.251.126.74:5349',
    username: 'vl',
    credential: 'bfPB1VMy',
  },
  {
    urls: 'stun:148.251.126.74:3478',
  },
  {
    urls: 'turn:148.251.126.74:3478',
    username: 'vl',
    credential: 'bfPB1VMy',
  },
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:stun01.sipphone.com' },
  { urls: 'stun:stun.ekiga.net' },
  { urls: 'stun:stun.fwdnet.net' },
  { urls: 'stun:stun.ideasip.com' },
  { urls: 'stun:stun.iptel.org' },
  { urls: 'stun:stun.rixtelecom.se' },
  { urls: 'stun:stun.schlund.de' },
  { urls: 'stun:stunserver.org' },
  { urls: 'stun:stun.softjoys.com' },
  { urls: 'stun:stun.voiparound.com' },
  { urls: 'stun:stun.voipbuster.com' },
  { urls: 'stun:stun.voipstunt.com' },
  { urls: 'stun:stun.voxgratia.org' },
  { urls: 'stun:stun.xten.com' },
];

export default WebRTC;
