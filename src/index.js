import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import {
  handleSingCommand,
  handleSkipCommand,
  handleStopCommand,
  handleQueueCommand
} from './commands/sing.js';

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) throw new Error('Missing DISCORD_BOT_TOKEN');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // 必须：读取文字内容
  ],
});

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot || !message.guild) return;

    const content = message.content.trim();
    if (content.startsWith('!sing ') || content.startsWith('/sing ')) {
      const query = content.replace(/^(!|\/)sing\s+/i, '');
      if (!query) return message.reply('用法：`!sing 歌名/歌手`');
      return handleSingCommand(message, query);
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

    // 可选：测试命令
    if (content === '!ping') {
      return message.reply('pong');
    }
  } catch (err) {
    console.error('messageCreate handler error:', err);
  }
});

// 全局兜底，避免静默崩溃
process.on('unhandledRejection', (r) => console.error('UNHANDLED REJECTION:', r));
process.on('uncaughtException', (e) => console.error('UNCAUGHT EXCEPTION:', e));

client.login(token);