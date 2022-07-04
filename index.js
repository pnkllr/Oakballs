const tmi = require('tmi.js');
const discord = require('discord.js');
const fs = require('fs');
const data = JSON.parse(fs.readFileSync("values.json"));
const fetch = require('node-fetch');
require('dotenv').config()

// ➤ S T A R T    B L O C K E D    W O R D S //
const BLOCKED_WORDS = [
    'f4f',
    'follow me',
]

const colors = ["SpringGreen", "Blue", "Chocolate", "Red", "Coral", "Firebrick", "OrangeRed", "SeaGreen", "Green", "HotPink"];

// ➤ S T A R T    O F    B O T   C O D E //
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

Twitch.on('connect', function(connection) {
    connection.sendUTF('CAP REQ :twitch.tv/tags twitch.tv/commands');
});

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
    Discord.user.setActivity(`https://twitch.tv/pnkllr`, { type: 'STREAMING' });
});

const trackChannel = '976101213986779166';

// ➤ D I S C O R D   E V E N T S
// Member Joins
Discord.on('guildMemberAdd', (member) => {
    member.guild.channels.fetch(trackChannel).then(channel => { channel.send(`\`\`\`diff\n+ ${member.displayName}\`\`\``) });
});

// Member Leaves
Discord.on('guildMemberRemove', (member) => {
    member.guild.channels.fetch(trackChannel).then(channel => { channel.send(`\`\`\`diff\n- ${member.displayName}\`\`\``) });
});

// ➤ T W I T C H   C H A N N E L   E V E N T S
// Hosted
Twitch.on('hosted', (channel, username, viewers, autohost) => {
    Twitch.say(channel, `Really @${username}? You want to share this with other people? Really?`);
});

// Raided
Twitch.on('raided', (channel, username, viewers) => {
    Twitch.say(channel, `Oh hey @${username} and their ${viewers} minions o/`);
});

// Sub
Twitch.on('subscription', (channel, username, method, message, tags) => {
    Discord.channels.fetch(trackChannel).then(channel => { channel.send(`\`\`\`asciidoc\n= New Subscriber =\n[${username}]\`\`\``) });
    Twitch.say(channel, `Oh no! @${userstate['display-name']} is wasting money =O`);
});

// Resub
Twitch.on('resub', (channel, username, months, message, tags, methods) => {
    Discord.channels.fetch(trackChannel).then(channel => { channel.send(`\`\`\`asciidoc\n= x${~~userstate["msg-param-cumulative-months"]} Month Subscriber =\n[${username}] :: ${message}\`\`\``) });
    Twitch.say(channel, `I guess you didn't learn the first time hey @${username}?`);
});

// Gift Sub
Twitch.on("subgift", (channel, username, streakMonths, recipient, methods, tags) => {
    Discord.channels.fetch(trackChannel).then(channel => { channel.send(`\`\`\`asciidoc\n= ${username} Gifted a Sub  =\n[${recipient}] :: ${streakMonths} Months Total\`\`\``) });
    Twitch.say(channel, `Im sure they have their own money @${username}`);
});

// Multible Gift Sub
//Twitch.on("submysterygift", (channel, username, numbOfSubs, methods, tags) => {
//    Discord.channels.fetch(trackChannel).then(channel => { channel.send(`\`\`\`asciidoc\n= ${username} Gifted ${numbOfSubs} Subs =\`\`\``) });
//    Twitch.say(channel, `While im sure they have their own money, its no doubt you are now broke @${username}`);
//});

// CHECK IF MESSAGE WAS SENT BY VIEWER
Twitch.on('message', (channel, userstate, message, self) => {
    if (self) return;
    if (message.toLowerCase() === 'hello') {
        Twitch.say(channel, `@${userstate['display-name']}, hey there!`);
    }
    if (message.toLowerCase() === 'back') {
        Twitch.say(channel, `@${userstate['display-name']}, welcome back`);
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
            Twitch.say(channel, `@${userstate['display-name']}, This is the server you're looking for https://discord.gg/UyQR5m6ACR`);
            break;
        case '!website':
            Twitch.say(channel, `@${userstate['display-name']}, Don't forget to add it to your bookmarks! https://pnkllr.net`);
            break;
        case '!socials':
            Twitch.say(channel, `Twitter: PnKllr || IG: PnKllrTV || YouTube: PnKllr`);
            break;
        case '!gt':
            Twitch.say(channel, `PnKllr || PnKllrTV`);
            break;
        case '!cc':
            Twitch.say(channel, `Use my Epic Creator Code when you make purchases in the Epic store and Fortnite: PnKllr`);
            break;
        case '!lurk':
            Twitch.say(channel, `@${userstate['display-name']}, PopCorn Thanks for Lurking! We hope you enjoy your stay PopCorn`);
            break;
        case '!clip':
            fetch(`https://pnkllr.net/clipit.php?username=${userstate['display-name']}`).then(res => res.text()).then(text => Twitch.say(channel, `Heres the Plunkup @${userstate['display-name']} ${text}`));
            break;
        case '!dead':
            if (ModOnly) {
                data.dead = ++data.dead;
                fs.writeFileSync("values.json", JSON.stringify(data, null, 4));
                Twitch.say(channel, `PnKllr has died ${data.dead} time(s)`);
            }
            break;
        case '!fall':
            if (ModOnly) {
                data.fall = ++data.fall;
                fs.writeFileSync("values.json", JSON.stringify(data, null, 4));
                Twitch.say(channel, `PnKllr has fallen ${data.fall} time(s)`);
            }
            break;
        case '!countreset':
            if (ModOnly) {
                data.dead = 0;
                data.fall = 0;
                fs.writeFileSync("values.json", JSON.stringify(data, null, 4));
                Twitch.say(channel, `Counters reset to 0!`);
            }
            break;
    }
});

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

// ➤ T I M E R S
function colorChange() {
    Twitch.color(colors[Math.floor(Math.random() * 10)]);
}
setInterval(colorChange, 300000);
// 300000 = timer goes off every 5 mins

// function StreamTimer() {
//     Twitch.say(process.env.CHANNEL_NAME, 'enjoying stream? Then why dont you leave a follow, say something in chat or even go follow PnKllr on social media');
// }
// setInterval(StreamTimer, 1.2e+6);
// 1.5e+6 = timer goes off every 20 mins
// 
// function DiscTimer() {
//     Twitch.say(process.env.CHANNEL_NAME, 'enjoying talking here? Continue the conversation over on Discord! https://discord.gg/qrFtuzn7jQ');
// }
// setInterval(DiscTimer, 1.8e+6);
// 1.8e+6 = timer goes off every 30 mins