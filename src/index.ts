import 'dotenv/config';
import {Client, Events, GatewayIntentBits} from 'discord.js';
import { handleSingCommand } from './commands/sing.js';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent
    ],
});

client.once(Events.ClientReady, (readyClient) => {
    console.log(`✅ Logged in as ${readyClient.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;

    if (message.content.startsWith('/sing')) {
        const args = message.content.split(' ').slice(1);
        const artist = args.join(' ');
        if (!artist) {
            await message.reply('📝 用法：/sing 歌手名');
            return;
        }

        await handleSingCommand(message, artist);
    }
});

client.login(process.env.DISCORD_BOT_TOKEN);