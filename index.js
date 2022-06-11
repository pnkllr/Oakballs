const tmi = require('tmi.js');
require('dotenv').config()

// ➤ S T A R T    B L O C K E D    W O R D S
const BLOCKED_WORDS = [
    'test',
]

// ➤ S T A R T    O F    B O T   C O D E
const options = {
    options: { debug: true, messagesLogLevel: "info" },
    connection: {
        reconnect: true,
        secure: true
    },
    identity: {
        username: process.env.BOT_USERNAME,
        password: process.env.BOT_OAUTH
    },
    channels: [process.env.CHANNEL_NAME]
}
const client = new tmi.Client(options);
client.connect();

// ➤ C H A N N E L   E V E N T S
client.on('hosted', (channel, username, viewers, autohost) => {
    onHostedHandler(channel, username, viewers, autohost)
});
client.on('raided', (channel, username, viewers) => {
    onRaidedHandler(channel, username, viewers)
});
client.on('subscription', (channel, username, method, message, userstate) => {
    onSubscriptionHandler(channel, username, method, message, userstate)
});

// CHECK IF MESSAGE WAS SENT BY VIEWER
client.on('message', (channel, userstate, message, self) => {
    if (self) return;
    if (message.toLowerCase() === 'hello') {
        client.say(channel, `@${userstate.username}, hey there!`);
    }
    if (message.toLowerCase() === 'back') {
        client.say(channel, `@${userstate.username}, welcome back`);
    }
    if (message.toLowerCase() === '^') {
        client.say(channel, `^`);
    }

    checkTwitchChat(userstate, message, channel)

    let isMod = userstate.mod || userstate['user-type'] === 'mod';
    let isBroadcaster = channel.slice(1) === userstate.username;
    let ModOnly = isMod || isBroadcaster;

    // START COMMANDS
    switch (message) {
        case '!discord':
            client.say(channel, `@${userstate.username}, This is the server you're looking for https://discord.gg/qrFtuzn7jQ`);
            break;
        case '!website':
            client.say(channel, `@${userstate.username}, Don't forget to add it to your bookmarks! https://pnkllr.net`);
            break;
        case '!lurk':
            client.say(channel, `@${userstate.username}, PopCorn Thanks for Lurking! We hope you enjoy your stay PopCorn`);
            break;
        case '!dead':
            if (ModOnly) {
                client.say(channel, `PnKllr has died ${addDeathCounter()} time(s)`);
            }
            break;
        case '!fall':
            if (ModOnly) {
                client.say(channel, `PnKllr has fallen ${addFallCounter()} time(s)`);
            }
            break;
    }
});

// ➤ C O U N T E R S
var deathCounter = 0;

function addDeathCounter() {
    return deathCounter = deathCounter + 1;
}
var fallCounter = 0;

function addFallCounter() {
    return fallCounter = fallCounter + 1;
}

// ➤ F U N C T I O N S
// CHECK BLOCKED WORDS
let shouldSendMessage = false

function checkTwitchChat(userstate, message, channel) {
    message = message.toLowerCase()
    shouldSendMessage = BLOCKED_WORDS.some(blockedWord => message.includes(blockedWord.toLowerCase()))
    if (shouldSendMessage) {
        client.say(channel, `@${userstate.username}, sorry you're message contained a no no`);
        client.deletemessage(channel, userstate.id)
    }
}

// ON HOST
function onHostedHandler(channel, username, viewers) {
    client.say(channel, `Thank you @${username} for the host of ${viewers}!`);
}

// ON RAID
function onRaidedHandler(channel, username, viewers) {
    client.say(channel, `THANK YOU @${username} FOR RAIDING WITH ${viewers}!`);
}

// ON SUB
function onSubscriptionHandler(channel, username) {
    client.say(channel, `THANK YOU @${username} FOR SUBBING, WELCOME TO THE TRASH CREW!`);
}

// ➤ T I M E R S
function StreamTimer() {
    client.action(channel(process.env.CHANNEL_NAME), 'enjoying stream? Then why dont you leave a follow, say something in chat or even go follow me on social media');
}
setInterval(StreamTimer, 1.2e+6);
// 1.5e+6 = timer goes off every 20 mins

function DiscTimer() {
    client.action(channel(process.env.CHANNEL_NAME), 'enjoying talking here? Continue the conversation over on Discord! https://discord.gg/qrFtuzn7jQ');
}
setInterval(DiscTimer, 1.8e+6);
// 1.8e+6 = timer goes off every 30 mins