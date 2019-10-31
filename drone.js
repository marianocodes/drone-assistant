const logger = require('morgan');
const bodyParser = require('body-parser');
const path = require('path');
const { spawn } = require('child_process');
const dgram = require('dgram');
const express = require('express');
const app = express();
const throttle = require('lodash/throttle');
const ws = require('ws');
const axios = require('axios');

const TELLO_COMMAND_PORT = 8889;
const TELLO_STATE_PORT = 8890;
const TELLO_VIDEO_PORT = 11111;
const TELLO_HOST = '192.168.10.1';

const SERVER_PORT = 6767;
const SERVER_HOST = 'localhost';

/**
 * ============================
 * Drone Config
 * ============================
 */
// Init drone connection
const drone = dgram.createSocket('udp4');
drone.bind(TELLO_COMMAND_PORT);

// Init drone SDK. 
drone.send('command', 0, 'command'.length, TELLO_COMMAND_PORT, TELLO_HOST, handleError);

// Command response
drone.on('message', message => {
  console.log(`🤖 : ${message}`);
});

// Listen drone state messages
// e.g temp or angles
const droneState = dgram.createSocket('udp4');
droneState.bind(TELLO_STATE_PORT);

droneState.on(
  'message',
  throttle(state => {
    const formattedState = parseState(state.toString());
    // uncomment to see the data in the terminal
    // console.log('drone messages', formattedState)
  }, 100)
);

function parseState(state) {
  return state
    .split(';')
    .map(x => x.split(':'))
    .reduce((data, [key, value]) => {
      data[key] = value;
      return data;
    }, {});
}


function handleError(err) {
  if (err) {
    console.log('ERROR');
    console.log(err);
  }
}

function sendCommand(command) {
  drone.send(command, 0, command.length, TELLO_COMMAND_PORT, TELLO_HOST, handleError);
}

/**
 * ============================
 * Server/Express Config
 * ============================
 */
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

// Enable static assets for FE
app.use(express.static(path.join(__dirname, 'public')))

// APIs to trigger commands from Node-Red
app.post('/command', ({ body }, res) => {
  const command = body.command;
  console.log(`Command: ${command}`);
  sendCommand(command)
  res.sendStatus(200);
});

app.post(`/streamon`, (req, res) => {
  console.log('Starting stream.')
  const command = 'streamon';
  sendCommand(command);
  res.end()
})

app.post(`/streamoff`, (req, res) => {
  console.log('Stopping stream.')
  const command = 'streamoff';
  sendCommand(command);
  res.end()
})

app.post(`/testing`, (req, res) => {
  console.log(req.body)
  res.end()
})

// Server Web page to stream video
app.get('/', (req, res, next) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
}); // takeoff, land, flip f

app.post(`/tellostream`, (req, res) => {
  res.connection.setTimeout(0)

  console.log(
    `Stream Connected: ${req.socket.remoteAddress}:${req.socket.remotePort}`
  )

  req.on('data', function (data) {
    wsServer.broadcast(data)
  })

  req.on('end', function () {
    console.log(
      `Stream Disconnected: ${req.socket.remoteAddress}:${req.socket.remotePort}`
    )
  })
})

const server = app.listen(SERVER_PORT, SERVER_HOST, () => {
  const host = server.address().address
  const port = server.address().port
  console.log(`Server started at http://${host}:${port}/`)
})

/**
 * ============================
 * Web Hook Relay Socket Config
 * ============================
 */
const webRelayHookURL = 'wss://my.webhookrelay.com/v1/socket';
const reconnectInterval = 1000 * 3;
let webRelaySocket;

const apiKey = process.env.RELAY_KEY;
const apiSecret = process.env.RELAY_SECRET;

const connect = function () {
  
  webRelaySocket = new ws(webRelayHookURL);

  webRelaySocket.on('open', function () {
    console.log('Connected to Web Relay, sending authentication request');
    webRelaySocket.send(JSON.stringify({ action: 'auth', key: apiKey, secret: apiSecret }));
  });

  webRelaySocket.on('message', async function incoming(data) {
    
    const { type, status, body } = JSON.parse(data);

    if (type === 'status' && status === 'authenticated') {
      webRelaySocket.send(JSON.stringify({ action: 'subscribe', buckets: ['gactions'] }));
    }

    // trigger command from Google Assistant -> Web Relay Hook -> Drone
    ifttAction(body);

  });

  webRelaySocket.on('error', function () {
    console.log('socket error');
  });

  webRelaySocket.on('close', function () {
    console.log('socket closed, reconnecting');
    setTimeout(connect, reconnectInterval);
  });
};

connect();

async function ifttAction(body) {
  if (body) {
    const { action } = JSON.parse(body);
    
    if (action) {
      console.log('Action coming from IFTTT', action);
      if (action === 'streamon') {
        await axios.post('http://localhost:6767/command', { command: 'streamon' })
        return;
      }
      sendCommand(action);
    }
  }
}

/**
 * ============================
 * Video Streaming Config
 * ============================
 */
const wsServer = new ws.Server({ server: server })

wsServer.on('connection', function (socket, upgradeReq) {
  const remoteAddress = (upgradeReq || socket.upgradeReq).socket.remoteAddress

  console.log(
    `WebSocket Connected: ${remoteAddress} (${wsServer.clients.size} total)`
  )

  socket.on('close', function (code, message) {
    console.log(
      `WebSocket Disonnected: ${remoteAddress} (${wsServer.clients.size} total)`
    )
  })
})

wsServer.broadcast = function (data) {
  wsServer.clients.forEach(function each(client) {
    if (client.readyState === ws.OPEN) {
      client.send(data)
    }
  })
}

const ffmpeg = spawn('ffmpeg', [
  '-hide_banner',
  '-i',
  `udp://${TELLO_HOST}:${TELLO_VIDEO_PORT}`,
  '-f',
  'mpegts',
  '-codec:v',
  'mpeg1video',
  '-s',
  '640x480',
  '-b:v',
  '800k',
  '-bf',
  '0',
  '-r',
  '20',
  `http://${SERVER_HOST}:${SERVER_PORT}/tellostream`
])

ffmpeg.stderr.on('data', data => {
  console.log(`stderr: ${data}`)
})

ffmpeg.on('close', code => {
  console.log(`child process exited with code ${code}`)
})

// Safely fill ffmpeg
const exitHandler = options => {
  if (options.cleanup) {
    ffmpeg.stderr.pause()
    ffmpeg.stdout.pause()
    ffmpeg.stdin.pause()
    ffmpeg.kill()
  }
  if (options.exit) {
    process.exit()
  }
}

process.on('exit', exitHandler.bind(null, { cleanup: true }))
process.on('SIGINT', exitHandler.bind(null, { exit: true }))
process.on('SIGUSR1', exitHandler.bind(null, { exit: true }))
process.on('SIGUSR2', exitHandler.bind(null, { exit: true }))
process.on('uncaughtException', exitHandler.bind(null, { exit: true }))
