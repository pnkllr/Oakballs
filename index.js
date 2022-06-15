const tmi = require('tmi.js');
const discord = require('discord.js');
require('dotenv').config()

// ➤ S T A R T    B L O C K E D    W O R D S
const BLOCKED_WORDS = [
    'f4f',
    'follow me',
]

// ➤ S T A R T    O F    B O T   C O D E
const Twitch = new tmi.Client({
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
});
Twitch.connect();

const Discord = new discord.Client({
    intents: [
        "GUILDS",
        "GUILD_MEMBERS",
        "GUILD_BANS",
        "GUILD_INTEGRATIONS",
        "GUILD_WEBHOOKS",
        "GUILD_INVITES",
        "GUILD_VOICE_STATES",
        "GUILD_PRESENCES",
        "GUILD_MESSAGES",
        "GUILD_MESSAGE_REACTIONS",
        "GUILD_MESSAGE_TYPING",
        "DIRECT_MESSAGES",
        "DIRECT_MESSAGE_REACTIONS",
        "DIRECT_MESSAGE_TYPING",
    ],
});
Discord.login(process.env.DISCORD_BOT_TOKEN).then(() => {
    console.log('Discord successfully logged in.');
    Discord.user.setActivity(`http://twitch.tv/pnkllr`, { type: 'WATCHING' });
});

const subchannel = Discord.channels.cache.get('976101213986779166');

// ➤ C H A N N E L   E V E N T S
Twitch.on('hosted', (channel, username, viewers, autohost) => {
    onHostedHandler(channel, username, viewers, autohost)
});
Twitch.on('raided', (channel, username, viewers) => {
    onRaidedHandler(channel, username, viewers)
});
Twitch.on('subscription', (channel, username, message, userstate) => {
    onSubscriptionHandler(channel, username, message, userstate)
});
Twitch.on('resub', (channel, username, message, userstate) => {
    onResubHandler(channel, username, message, userstate)
});
Twitch.on("subgift", (channel, username, recipient, userstate) => {
    onGiftsubHandler(channel, username, recipient, userstate)
});
Twitch.on("submysterygift", (channel, username, numbOfSubs, userstate) => {
    onMysterysubHandler(channel, username, numbOfSubs, userstate)
});

// CHECK IF MESSAGE WAS SENT BY VIEWER
Twitch.on('message', (channel, userstate, message, self) => {
    if (self) return;
    if (message.toLowerCase() === 'hello') {
        Twitch.say(channel, `@${userstate.username}, hey there!`);
    }
    if (message.toLowerCase() === 'back') {
        Twitch.say(channel, `@${userstate.username}, welcome back`);
    }
    if (message.toLowerCase() === '^') {
        Twitch.say(channel, `^`);
    }

    checkTwitchChat(userstate, message, channel)

    let isMod = userstate.mod || userstate['user-type'] === 'mod';
    let isBroadcaster = channel.slice(1) === userstate.username;
    let ModOnly = isMod || isBroadcaster;

    // START COMMANDS
    switch (message) {
        case '!discord':
            Twitch.say(channel, `@${userstate.username}, This is the server you're looking for https://discord.gg/qrFtuzn7jQ`);
            break;
        case '!website':
            Twitch.say(channel, `@${userstate.username}, Don't forget to add it to your bookmarks! https://pnkllr.net`);
            break;
        case '!socials':
            Twitch.say(channel, `Twitter: PnKllr || IG: PnKllrTV || YouTube: PnKllr`);
            break;
        case '!cc':
            Twitch.say(channel, `Use my Epic Creator Code when you make purchases in the Epic store and Fortnite: PnKllr`);
            break;
        case '!lurk':
            Twitch.say(channel, `@${userstate.username}, PopCorn Thanks for Lurking! We hope you enjoy your stay PopCorn`);
            break;
        case '!dead':
            if (ModOnly) {
                Twitch.say(channel, `PnKllr has died ${addDeathCounter()} time(s)`);
            }
            break;
        case '!fall':
            if (ModOnly) {
                Twitch.say(channel, `PnKllr has fallen ${addFallCounter()} time(s)`);
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
        Twitch.say(channel, `@${userstate.username}, sorry you're message contained a no no`);
        Twitch.deletemessage(channel, userstate.id)
    }
}

// ON HOST
function onHostedHandler(channel, username, viewers) {
    Twitch.say(channel, `Really @${username}? You want to share this with ${viewers} other people? Really?`);
}

// ON RAID
function onRaidedHandler(channel, username, viewers) {
    Twitch.say(channel, `Oh hey @${username} and their ${viewers} minions o/`);
}

// ON SUB
function onSubscriptionHandler(channel, username) {
    subchannel.send(`\`\`\`asciidoc\n= New Subscriber =\n[${username}]\`\`\``);
    Twitch.say(channel, `Oh no! @${username} is wasting money =O`);
}

// ON RESUB
function onResubHandler(channel, username, userstate, message) {
    subchannel.send(`\`\`\`asciidoc\n= x${userstate["msg-param-cumulative-months"]} Month Subscriber =\n[${username}] :: ${message}\`\`\``);
    Twitch.say(channel, `I guess you didn't learn the first time hey @${username}?`);
}

// ON GIFT SUB
function onGiftsubHandler(channel, username, recipient, userstate) {
    subchannel.send(`\`\`\`asciidoc\n= ${username} Gifted a Sub  =\n[${recipient}]\n\nThey have gifted a total of ${userstate["msg-param-sender-count"]} subs\`\`\``);
    Twitch.say(channel, `Im sure they have their own money @${username}`);
}

// ON MYSTERY GIFT SUB
function onMysterysubHandler(channel, username, numbOfSubs, userstate) {
    subchannel.send(`\`\`\`asciidoc\n= ${username} Gifted ${numbOfSubs} Subs =\nThey have gifted a total of ${userstate["msg-param-sender-count"]} subs\`\`\``);
    Twitch.say(channel, `While im sure they have their own money, its no doubt you are now broke @${username}`);
}

// ➤ T I M E R S
function StreamTimer() {
    Twitch.say(process.env.CHANNEL_NAME, 'enjoying stream? Then why dont you leave a follow, say something in chat or even go follow PnKllr on social media');
}
setInterval(StreamTimer, 1.2e+6);
// 1.5e+6 = timer goes off every 20 mins

function DiscTimer() {
    Twitch.say(process.env.CHANNEL_NAME, 'enjoying talking here? Continue the conversation over on Discord! https://discord.gg/qrFtuzn7jQ');
}
setInterval(DiscTimer, 1.8e+6);
// 1.8e+6 = timer goes off every 30 mins