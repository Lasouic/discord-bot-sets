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
      trackSupplier: null,
    });
  }
  return queues.get(guildId);
}

export function destroyGuildQueue(guildId) {
  const q = queues.get(guildId);
  if (!q) return;
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
  return playNext(guildQueue, fetchStream, onStart, onError, onFinish, getNextTrack);
}

export function clearQueue(guildQueue) {
  guildQueue.queue.length = 0;
}

async function playNext(guildQueue, fetchStream, onStart, onError, onFinish, getNextTrack) {
  if (typeof getNextTrack === 'function') {
    guildQueue.trackSupplier = getNextTrack;
  }

  const supplier = typeof getNextTrack === 'function' ? getNextTrack : guildQueue.trackSupplier;
  // 队列空 → 让供应器补充
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
  guildQueue.nowPlaying = track;

  try {
    const streamObj = await fetchStream(track);

    // ⭐ 关键：每首歌都重建全新的 AudioPlayer，并重新订阅到连接
    const newPlayer = createAudioPlayer();
    const oldSub = guildQueue.subscription;
    const oldPlayer = guildQueue.player;

    guildQueue.player = newPlayer;
    guildQueue.subscription = guildQueue.connection.subscribe(newPlayer);
    try { oldSub?.unsubscribe?.(); } catch {}
    try { oldPlayer?.stop?.(true); } catch {}

    console.log('[PLAY]', track.title, '|', track.url);
    const resource = createAudioResource(streamObj.stream, { inputType: streamObj.type });
    newPlayer.play(resource);
    onStart?.(track);

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