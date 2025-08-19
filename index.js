const tmi = require('tmi.js');
const discord = require('discord.js');
const fs = require('fs/promises'); // Use fs.promises for async file handling
const fetch = require('node-fetch');
require('dotenv').config();

// Initialize 'data' by reading from values.json, or default to 0 if the file doesn't exist
let data = { dead: 0, fall: 0 };

async function loadData() {
    try {
        const fileData = await fs.readFile('values.json', 'utf8');
        data = JSON.parse(fileData); // Load saved data from file
    } catch (err) {
        console.log("No saved data found, initializing with defaults.");
        await fs.writeFile('values.json', JSON.stringify(data, null, 4)); // Create the file if it doesn't exist
    }
}

// Load data at the start
loadData();

// ➤ S T A R T    B L O C K E D    W O R D S //
const BLOCKED_WORDS = ['f4f', 'follow me'].map(w => w.toLowerCase());

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
    Discord.user.setActivity(`TTV: PnKllr`, { type: 'STREAMING', url: 'https://twitch.tv/pnkllr' });
});

const trackChannel = '1403975109735350395';

// ➤ D I S C O R D   E V E N T S
// Member Joins
Discord.on('guildMemberAdd', async (member) => {
    try {
        const channel = await member.guild.channels.fetch(trackChannel);
        channel.send(`\`\`\`diff\n+ ${member.displayName}\`\`\``);
    } catch (err) {
        console.error('Error sending join message:', err);
    }
});

// Member Leaves
Discord.on('guildMemberRemove', async (member) => {
    try {
        const channel = await member.guild.channels.fetch(trackChannel);
        channel.send(`\`\`\`diff\n- ${member.displayName}\`\`\``);
    } catch (err) {
        console.error('Error sending leave message:', err);
    }
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
Twitch.on('subscription', async (channel, username, method, message, tags) => {
    await Discord.channels.fetch(trackChannel).then(channel => {
        channel.send(`\`\`\`asciidoc\n= New Subscriber =\n[${username}]\`\`\``);
    });
    Twitch.say(channel, `Oh no! @${username} is wasting money =O`);
});

// Resub
Twitch.on('resub', async (channel, username, months, message, tags, methods) => {
    await Discord.channels.fetch(trackChannel).then(channel => {
        channel.send(`\`\`\`asciidoc\n= x${tags["msg-param-cumulative-months"]} Month Subscriber =\n[${username}] :: ${message}\`\`\``);
    });
    Twitch.say(channel, `I guess you didn't learn the first time hey @${username}?`);
});

// Gift Sub
Twitch.on("subgift", async (channel, username, streakMonths, recipient, methods, tags) => {
    await Discord.channels.fetch(trackChannel).then(channel => {
        channel.send(`\`\`\`asciidoc\n= ${username} Gifted a Sub  =\n[${recipient}] :: ${~tags["msg-param-gift-months"]} Months Total\`\`\``);
    });
    Twitch.say(channel, `Im sure they have their own money @${username}`);
});

// CHECK IF MESSAGE WAS SENT BY VIEWER
Twitch.on('message', handleTwitchMessage);

async function handleTwitchMessage(channel, userstate, message, self) {
    if (self) return;

    // handle greetings
    if (message.toLowerCase() === 'hello') {
        Twitch.say(channel, `@${userstate['display-name']}, hey there!`);
    }
    if (message.toLowerCase() === 'back') {
        Twitch.say(channel, `@${userstate['display-name']}, welcome back`);
    }
    if (message.toLowerCase() === '^') {
        Twitch.say(channel, `^`);
    }

    checkTwitchChat(userstate, message, channel);

    const isModOrBroadcaster = userstate.mod || userstate['user-type'] === 'mod' || channel.slice(1) === userstate.username;

    // START COMMANDS
    const commandMap = {
        '!commands': () => `[ !discord | !website | !socials | !gt | !cc | !lurk | !clip | !wickd | !dead | !fall | !countreset ]`,
        '!discord': (user) => `@${userstate['display-name']}, This is the server you're looking for ${process.env.DISCORD_INVITE}`,
        '!website': () => `@${userstate['display-name']}, Don't forget to add it to your bookmarks! ${process.env.WEBSITE}`,
        '!socials': () => `Twitter: PnKllr || YouTube: PnKllr`,
        '!gt': () => `PnKllr || PnKllrTV`,
        '!cc': () => `Use my Epic Creator Code when you make purchases in the Epic store and Fortnite: PnKllr`,
        '!lurk': (user) => `@${userstate['display-name']}, PopCorn Thanks for Lurking! We hope you enjoy your stay PopCorn`,
        '!clip': async () => {
            const res = await fetch(`https://pnkllr.net/clipit.php?username=${userstate['display-name']}`);
            const text = await res.text();
            return `Heres the Plunkup @${userstate['display-name']} ${text}`;
        },
        '!wickd': () => `Check out our range of Wick'd Geek gear at https://wickdgeek.com. Use coupon: Twitch for 5% off`,
        '!dead': async () => {
            if (isModOrBroadcaster) {
                data.dead = ++data.dead;
                await fs.writeFile('values.json', JSON.stringify(data, null, 4)); // Save data to file
                return `PnKllr has died ${data.dead} time(s)`;
            }
        },
        '!fall': async () => {
            if (isModOrBroadcaster) {
                data.fall = ++data.fall;
                await fs.writeFile('values.json', JSON.stringify(data, null, 4)); // Save data to file
                return `PnKllr has fallen ${data.fall} time(s)`;
            }
        },
        '!countreset': async () => {
            if (isModOrBroadcaster) {
                data.dead = 0;
                data.fall = 0;
                await fs.writeFile('values.json', JSON.stringify(data, null, 4)); // Save reset data
                return `Counters reset to 0!`;
            }
        },
    };

    const response = commandMap[message.toLowerCase()];
    if (response) {
        const msg = typeof response === 'function' ? await response(userstate['display-name']) : response;
        Twitch.say(channel, msg);
    }
}

// ➤ F U N C T I O N S
// CHECK BLOCKED WORDS
let shouldSendMessage = false;

function checkTwitchChat(userstate, message, channel) {
    message = message.toLowerCase();
    shouldSendMessage = BLOCKED_WORDS.some(blockedWord => message.includes(blockedWord));
    if (shouldSendMessage) {
        Twitch.say(channel, `@${userstate.username}, sorry your message contained a no no`);
        Twitch.deletemessage(channel, userstate.id);
    }
}

// ➤ T I M E R S
const colors = ["SpringGreen", "Blue", "Chocolate", "Red", "Coral", "Firebrick", "OrangeRed", "SeaGreen", "Green", "HotPink"];

function colorChange() {
    const color = colors[Math.floor(Math.random() * colors.length)];
    Twitch.say(channel, `/color ${color}`);
    console.log(`Changed color to ${color}`);
}
setInterval(colorChange, 300000); // 300000 = timer goes off every 5 mins

const timers = [
    "Enjoying stream? Then why dont you leave a follow, say something in chat or even go follow PnKllr on social media.",
    "Continue the conversation over on Discord! https://discord.gg/nth7y8TqMT",
    "Check out our Wick'd Geek Collection! https://wickdgeek.com",
    "See something dumb on stream? Use !clip to capture it!",
    "To view a list of commands, use !commands"
];

function DiscTimer() {
    Twitch.say(process.env.CHANNEL_NAME, timers[Math.floor(Math.random() * timers.length)]);
}
setInterval(DiscTimer, 1.8e+6); // 1.8e+6 = timer goes off every 30 mins
