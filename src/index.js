import 'dotenv/config';
import { Client, GatewayIntentBits, Events } from 'discord.js';
import {
  handleSingCommand,
  handleAnotherCommand,
  handleSkipCommand,
  handleStopCommand,
  handleQueueCommand
} from './commands/sing.js';

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) throw new Error('Missing DISCORD_BOT_TOKEN. Put it in .env or environment.');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, (c) => {
  console.log(`✅ ClientReady: Logged in as ${c.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot || !message.guild) return;
    const content = (message.content ?? '').trim();

    if (content.startsWith('!sing ') || content.startsWith('/sing ')) {
      const query = content.replace(/^(!|\/)sing\s+/i, '');
      if (!query) return message.reply('用法：`!sing 歌手`');
      return handleSingCommand(message, query);
    }

    if (content === '!another' || content === '/another') {
      return handleAnotherCommand(message);
    }

    if (content === '!skip' || content === '/skip') {
      return handleSkipCommand(message);
    }

    if (content === '!stop' || content === '/stop') {
      return handleStopCommand(message);
    }

    if (content === '!queue' || content === '/queue') {
      return handleQueueCommand(message);
    }

    if (content === '!ping') {
      return message.reply('pong');
    }
  } catch (err) {
    console.error('messageCreate handler error:', err);
  }
});

process.on('unhandledRejection', (r) => console.error('UNHANDLED REJECTION:', r));
process.on('uncaughtException', (e) => console.error('UNCAUGHT EXCEPTION:', e));

client.login(token);