# Flying the Tello Drone with the Google Assisant
This is an experimental code which listen to a webhook socket to trigger commands to the Tello drone. 

## How does it work?
 
**Flow**
1. Google Assitant trigger an action and send it to IFTTT
2. IFTTT listen to the action and forward it to the webhook
3. NodeJS sockets listen to the webhook and send the command to the drone

**What do I need?**
1. A Tello drone
2. Connection to internet by ethernet
3. Wifi adaptor (in case your computer doesn't have one)
4. NodeJS 10 or above installed
5. Create IFTTT applets (they've not been published yet)

**How to run the project?**
1. Run `npm i` 
2. Connect to the drone's wifi.
3. Run `node drone.js`

**Commands supported**
Tellos drone [manual](https://terra-1-g.djicdn.com/2d4dce68897a46b19fc717f3576b7c6a/Tello%20%E7%BC%96%E7%A8%8B%E7%9B%B8%E5%85%B3/For%20Tello/Tello%20SDK%20Documentation%20EN_1.3_1122.pdf)

**IFTTT Applets***
- Fly the drone
- Land the drone
- Flip the drone
- Stream video using the drone
- Stop the streaming

**Steaming**
Open [http://localhost:6767/](http://localhost:6767/) after triggering the `streaming video` command.


To improve:
- Separation of concerns
- Streaming config
- Update drone firmware to 2.0 and retest code
- Publish IFTTT applets