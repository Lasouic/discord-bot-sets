import 'dotenv/config';
import { Client, GatewayIntentBits, Events } from 'discord.js';
import { getCommand, listCommands } from './commands/index.js';
import { parseCommand } from './utils/commandParser.js';

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
    const parsed = parseCommand(message.content ?? '');
    if (!parsed) return;

    const command = getCommand(parsed.name);
    if (!command) {
      if (parsed.name === 'help') {
        const lines = listCommands()
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((cmd) => `• **${cmd.usage}** — ${cmd.description}`);
        await message.reply(
          '📚 可用指令：\n' + lines.join('\n') + '\n📝 更多指令敬请期待！'
        );
      }
      return;
    }

    await command.run(message, parsed.args);
  } catch (err) {
    console.error('messageCreate handler error:', err);
    if (message?.channel) {
      try {
        await message.reply('😵 机器人刚刚绊了一下脚，请稍后再试。');
      } catch (replyError) {
        console.error('failed to send fallback reply:', replyError);
      }
    }
  }
});

process.on('unhandledRejection', (r) => console.error('UNHANDLED REJECTION:', r));
process.on('uncaughtException', (e) => console.error('UNCAUGHT EXCEPTION:', e));

client.login(token);