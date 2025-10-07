import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  entersState,
  VoiceConnectionStatus
} from '@discordjs/voice';

const queues = new Map(); // guildId -> { connection, channel, player, subscription, queue: [], nowPlaying, trackSupplier }
export function getGuildQueue(guildId) {
  if (!queues.has(guildId)) {
    queues.set(guildId, {
      connection: null,
      channel: null,
      player: null,
      subscription: null,
      queue: [],
      nowPlaying: null,
      onIdleBound: false,
      trackSupplier: undefined,
    });
  }
  return queues.get(guildId);
}

export function destroyGuildQueue(guildId) {
  const q = queues.get(guildId);
  if (!q) return;
  q.trackSupplier = null;
  q.nowPlaying = null;
  q.queue.length = 0;
  try {
    q.subscription?.unsubscribe?.();
  } catch {}
  try {
    q.player?.stop?.(true);
  } catch {}
  try {
    if (q.connection && q.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      q.connection.destroy();
    }
  } catch {}
  q.connection = null;
  q.player = null;
  q.subscription = null;
  q.channel = null;
  queues.delete(guildId);
}

export async function ensureConnection(guildQueue, guild, voiceChannel) {
  if (!guildQueue.connection || guildQueue.connection.state.status === VoiceConnectionStatus.Destroyed) {
    guildQueue.channel = voiceChannel;
    guildQueue.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator
    });
    await entersState(guildQueue.connection, VoiceConnectionStatus.Ready, 30_000);
  }

  // 确保至少有一个 player（真正开始播放时我们还会重建一次，见下）
  if (!guildQueue.player) {
    guildQueue.player = createAudioPlayer();
    // 订阅：保存旧订阅并退订，保证连接只跟当前 player 绑定
    const oldSub = guildQueue.subscription;
    guildQueue.subscription = guildQueue.connection.subscribe(guildQueue.player);
    try { oldSub?.unsubscribe?.(); } catch {}
  }
}

// 当播放器空闲时尝试开始播放（若队列空则调用 getNextTrack 供应器补一首）
export async function startIfIdle(
  guildQueue,
  fetchStream,
  onStart,
  onError,
  onFinish,
  getNextTrack
) {
  if (guildQueue.player && guildQueue.player.state.status === AudioPlayerStatus.Playing) return;
  await playNext(guildQueue, fetchStream, onStart, onError, onFinish, getNextTrack);
}

export async function skip(
  guildQueue,
  fetchStream,
  onStart,
  onError,
  onFinish,
  getNextTrack
) {
  // 立即停止当前并切下一首
  try { guildQueue.player?.stop?.(true); } catch {}
  return;
}

export function clearQueue(guildQueue) {
  guildQueue.queue.length = 0;
}

async function playNext(guildQueue, fetchStream, onStart, onError, onFinish, getNextTrack) {
  if (typeof getNextTrack === 'function') {
    guildQueue.trackSupplier = getNextTrack;
  }

  if (!guildQueue.connection || guildQueue.connection.state.status === VoiceConnectionStatus.Destroyed) {
    return;
  }

  const supplier = typeof getNextTrack === 'function' ? getNextTrack : guildQueue.trackSupplier;
  if (!guildQueue.queue.length && guildQueue.trackSupplier === null && typeof supplier !== 'function') {
    return;
  }

  if (!guildQueue.queue.length && typeof supplier === 'function') {
    const refill = await supplier().catch(() => null);
    if (refill) guildQueue.queue.push(refill);
  }

  if (!guildQueue.queue.length) {
    onFinish?.();
    destroyGuildQueue(guildQueue.channel.guild.id);
    return;
  }

  const track = guildQueue.queue.shift();

  try {
    const streamObj = await fetchStream(track);
    guildQueue.nowPlaying = track;

    const newPlayer = createAudioPlayer();
    const oldSub = guildQueue.subscription;
    const oldPlayer = guildQueue.player;

    guildQueue.player = newPlayer;
    guildQueue.subscription = guildQueue.connection.subscribe(newPlayer);
    try { oldSub?.unsubscribe?.(); } catch {}
    try { oldPlayer?.stop?.(true); } catch {}

    console.log('[PLAY]', guildQueue.nowPlaying.title, '|', guildQueue.nowPlaying.url);
    const resource = createAudioResource(streamObj.stream, { inputType: streamObj.type });
    newPlayer.play(resource);
    onStart?.(guildQueue.nowPlaying);

    // 绑定一次性事件（绑定到 newPlayer，避免旧实例的事件干扰）
    newPlayer.once(AudioPlayerStatus.Idle, () => {
      playNext(guildQueue, fetchStream, onStart, onError, onFinish, null);
    });
    newPlayer.on('error', (e) => {
      onError?.(e, guildQueue.nowPlaying);
      playNext(guildQueue, fetchStream, onStart, onError, onFinish, null);
    });

  } catch (err) {
    onError?.(err, track);
    // 播放失败，尝试下一首
    return playNext(guildQueue, fetchStream, onStart, onError, onFinish, null);
  }
}