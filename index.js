// bot.js
// Node 18+ recommended. Run: npm i tmi.js discord.js dotenv
// If you're on Node <18, also: npm i node-fetch and uncomment the import below.

require('dotenv').config();

const tmi = require('tmi.js');
const { Client, GatewayIntentBits, Partials, ActivityType } = require('discord.js');
const fs = require('fs/promises');
const path = require('path');
// const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args)); // Node <18 fallback

// --------------------------
// Config & Guards
// --------------------------
const REQUIRED_ENV = [
  'BOT_USERNAME',
  'BOT_OAUTH',
  'CHANNEL_NAME',         // e.g. "pnkllr" (no #)
  'DISCORD_BOT_TOKEN',
  'DISCORD_INVITE',
  'WEBSITE',
  // optionally: TRACK_CHANNEL_ID
];
for (const key of REQUIRED_ENV) {
  if (!process.env[key] || String(process.env[key]).trim() === '') {
    console.error(`Missing env: ${key}`);
  }
}
const TRACK_CHANNEL_ID = process.env.TRACK_CHANNEL_ID || '1403975109735350395';

const TWITCH_CHANNEL_NAME = process.env.CHANNEL_NAME.replace(/^#/, '');
const TWITCH_CHANNEL = `#${TWITCH_CHANNEL_NAME}`;

const DATA_FILE = path.resolve(__dirname, 'values.json');

// --------------------------
// Persistent Counters (with simple write queue)
// --------------------------
let data = { dead: 0, fall: 0 };
let _writeInFlight = Promise.resolve();

async function loadData() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed.dead === 'number') data.dead = parsed.dead;
    if (typeof parsed.fall === 'number') data.fall = parsed.fall;
  } catch {
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
  }
}

function saveData(next = data) {
  // queue writes to avoid races/corruption
  _writeInFlight = _writeInFlight.then(() =>
    fs.writeFile(DATA_FILE, JSON.stringify(next, null, 2)).catch(err => {
      console.error('Failed to write values.json:', err);
    })
  );
  return _writeInFlight;
}

// --------------------------
// Blocked Words
// --------------------------
const BLOCKED_WORDS = ['f4f', 'follow me'];

// --------------------------
// Discord (v14)
// --------------------------
const Discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel], // for DMs if needed
});

let trackedChannel = null;

Discord.once('ready', async () => {
  console.log(`Discord logged in as ${Discord.user.tag}`);
  Discord.user.setActivity({ name: 'TTV: PnKllr', type: ActivityType.Streaming, url: 'https://twitch.tv/pnkllr' });

  try {
    trackedChannel = await Discord.channels.fetch(TRACK_CHANNEL_ID);
  } catch (err) {
    console.error('Failed to fetch track channel:', err);
  }
});

Discord.on('guildMemberAdd', async (member) => {
  try {
    const ch = trackedChannel || await member.guild.channels.fetch(TRACK_CHANNEL_ID);
    await ch.send('```diff\n+ ' + member.displayName + '```');
  } catch (err) {
    console.error('Error sending join message:', err);
  }
});

Discord.on('guildMemberRemove', async (member) => {
  try {
    const ch = trackedChannel || await member.guild.channels.fetch(TRACK_CHANNEL_ID);
    await ch.send('```diff\n- ' + member.displayName + '```');
  } catch (err) {
    console.error('Error sending leave message:', err);
  }
});

// --------------------------
// Twitch (tmi.js)
// --------------------------
const Twitch = new tmi.Client({
  options: { debug: false, messagesLogLevel: 'info' },
  connection: { reconnect: true, secure: true },
  identity: {
    username: process.env.BOT_USERNAME,
    password: process.env.BOT_OAUTH
  },
  channels: [TWITCH_CHANNEL] // must be prefixed with '#'
});

function isModOrBroadcaster(channel, userstate) {
  const isMod = !!userstate.mod;
  const isBroadcaster = userstate.badges && userstate.badges.broadcaster === '1';
  // Fallback: compare usernames
  const isOwner = TWITCH_CHANNEL_NAME.toLowerCase() === String(userstate.username || '').toLowerCase();
  return isMod || isBroadcaster || isOwner;
}

function safeSay(channel, msg) {
  if (!msg) return;
  return Twitch.say(channel, String(msg)).catch(err => {
    // Ignore typical ratelimit/Unknown command errors
    console.warn('Twitch.say error:', err?.message || err);
  });
}

Twitch.on('connected', async () => {
  // Request tags & commands explicitly; tmi handles this fine but explicit is okay
  try { Twitch.raw('CAP REQ :twitch.tv/tags twitch.tv/commands'); } catch {/* noop */}
  console.log('Connected to Twitch.');
});

Twitch.on('hosted', (channel, username) => {
  safeSay(channel, `Really @${username}? You want to share this with other people? Really?`);
});

Twitch.on('raided', (channel, username, viewers) => {
  safeSay(channel, `Oh hey @${username} and their ${viewers} minions o/`);
});

Twitch.on('subscription', async (channel, username) => {
  try {
    if (trackedChannel) {
      await trackedChannel.send(`\`\`\`asciidoc
= New Subscriber =
[${username}]
\`\`\``);
    }
  } catch (e) { console.error(e); }
  safeSay(channel, `Oh no! @${username} is wasting money =O`);
});

Twitch.on('resub', async (channel, username, _months, message, tags) => {
  const months = Number(tags?.['msg-param-cumulative-months']) || _months || 0;
  try {
    if (trackedChannel) {
      await trackedChannel.send(
        '```asciidoc\n' +
        `= x${months} Month Subscriber =\n` +
        `[${username}] :: ${message || ''}\n` +
        '```'
      );
    }
  } catch (e) { console.error(e); }
  safeSay(channel, `I guess you didn't learn the first time hey @${username}?`);
});

Twitch.on('subgift', async (channel, username, _streakMonths, recipient, _methods, tags) => {
  const totalGiftMonths = Number(tags?.['msg-param-gift-months']) || 1; // FIX: avoid bitwise ~ bug
  try {
    if (trackedChannel) {
      await trackedChannel.send(
        '```asciidoc\n' +
        `= ${username} Gifted a Sub =\n` +
        `[${recipient}] :: ${totalGiftMonths} Months Total\n` +
        '```'
      );
    }
  } catch (e) { console.error(e); }
  safeSay(channel, `I'm sure they have their own money @${username}`);
});

// --------------------------
// Chat moderation & commands
// --------------------------
const COMMAND_PREFIX = '!';
const commandCooldowns = new Map(); // key: command|user, value: timestamp
const COOLDOWN_MS = 3000;

function onCooldown(key) {
  const now = Date.now();
  const until = commandCooldowns.get(key) || 0;
  if (until > now) return true;
  commandCooldowns.set(key, now + COOLDOWN_MS);
  return false;
}

Twitch.on('message', async (channel, userstate, message, self) => {
  if (self) return;

  // Basic greets
  const lower = message.trim().toLowerCase();
  if (lower === 'hello') return safeSay(channel, `@${userstate['display-name']}, hey there!`);
  if (lower === 'back')  return safeSay(channel, `@${userstate['display-name']}, welcome back`);
  if (lower === '^')     return safeSay(channel, '^');

  // Blocked words check
  if (BLOCKED_WORDS.some(w => lower.includes(w))) {
    safeSay(channel, `@${userstate.username}, sorry your message contained a no no`);
    try {
      if (typeof Twitch.deletemessage === 'function') {
        await Twitch.deletemessage(channel, userstate.id);
      } else if (typeof Twitch.deleteMessage === 'function') {
        await Twitch.deleteMessage(channel, userstate.id);
      }
    } catch (err) {
      console.warn('Failed to delete message (permissions?):', err?.message || err);
    }
    return;
  }

  // Commands
  if (!lower.startsWith(COMMAND_PREFIX)) return;

  const [cmd, ...args] = message.trim().split(/\s+/);
  const isPrivileged = isModOrBroadcaster(channel, userstate);

  const commands = {
    '!commands': () =>
      `[ !discord | !website | !socials | !gt | !cc | !lurk | !clip | !wickd | !dead | !fall | !countreset ]`,

    '!discord': () =>
      `@${userstate['display-name']}, This is the server you're looking for ${process.env.DISCORD_INVITE}`,

    '!website': () =>
      `@${userstate['display-name']}, Don't forget to add it to your bookmarks! https://pnkllr.net`,

    '!socials': () => `Twitter: PnKllr || YouTube: PnKllr`,

    '!gt': () => `PnKllr || PnKllrTV`,

    '!cc': () => `Use my Epic Creator Code when you make purchases in the Epic store and Fortnite: PnKllr`,

    '!lurk': () =>
      `@${userstate['display-name']}, PopCorn Thanks for Lurking! We hope you enjoy your stay PopCorn`,

    '!clip': async () => {
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 10_000);
        const res = await fetch(`https://pnkllr.net/clipit.php?username=${encodeURIComponent(userstate['display-name'])}`, { signal: controller.signal });
        clearTimeout(t);
        const text = await res.text();
        return `Heres the Plunkup @${userstate['display-name']} ${text}`;
      } catch (e) {
        return `@${userstate['display-name']} failed to clip right now. Try again in a moment.`;
      }
    },

    '!wickd': () =>
      `Check out our range of Wick'd Geek gear at https://wickdgeek.com.`,

    '!dead': async () => {
      if (!isPrivileged) return;
      data.dead += 1;
      await saveData();
      return `PnKllr has died ${data.dead} time(s)`;
    },

    '!fall': async () => {
      if (!isPrivileged) return;
      data.fall += 1;
      await saveData();
      return `PnKllr has fallen ${data.fall} time(s)`;
    },

    '!countreset': async () => {
      if (!isPrivileged) return;
      data.dead = 0;
      data.fall = 0;
      await saveData();
      return `Counters reset to 0!`;
    }
  };

  const fn = commands[cmd.toLowerCase()];
  if (!fn) return;

  const cdKey = `${cmd}|${userstate.username}`;
  if (onCooldown(cdKey)) return; // prevent spam/bursts

  const out = await fn(args);
  if (out) safeSay(channel, out);
});

// --------------------------
// Timers
// --------------------------
const colors = ["SpringGreen", "Blue", "Chocolate", "Red", "Coral", "Firebrick", "OrangeRed", "SeaGreen", "Green", "HotPink"];

function colorChange() {
  const color = colors[(Math.random() * colors.length) | 0];
  // color change is a PRIVMSG command; send to the joined channel
  safeSay(TWITCH_CHANNEL, `/color ${color}`);
  console.log(`Changed color to ${color}`);
}
setInterval(colorChange, 300_000); // 5 min

const timers = [
  "Enjoying stream? Then why dont you leave a follow, say something in chat or even go follow PnKllr on social media.",
  "Continue the conversation over on Discord! https://discord.gg/nth7y8TqMT",
  "Check out our Wick'd Geek Collection! https://wickdgeek.com",
  "See something dumb on stream? Use !clip to capture it!",
  "To view a list of commands, use !commands"
];

function discTimer() {
  safeSay(TWITCH_CHANNEL, timers[(Math.random() * timers.length) | 0]);
}
setInterval(discTimer, 1_800_000); // 30 min

// --------------------------
// Boot & Shutdown
// --------------------------
(async function main() {
  await loadData();

  await Promise.allSettled([
    Discord.login(process.env.DISCORD_BOT_TOKEN),
    Twitch.connect()
  ]);

  process.on('SIGINT', async () => {
    console.log('Shutting down...');
    try { await saveData(); } catch {}
    process.exit(0);
  });
})();
