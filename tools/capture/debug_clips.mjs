export default async function (c) {
  await c.api('manual', true);
  const r = await c.eval(() => {
    const sk = window.__skate.game.skater;
    const out = [];
    for (const [n, clip] of sk.clips) out.push(`${n}: ${clip.tracks.length} tracks, ${clip.duration.toFixed(2)}s, first: ${clip.tracks.slice(0, 2).map((t) => t.name).join(' | ')}`);
    const bones = [];
    sk.model.traverse((o) => { if (o.isBone && bones.length < 4) bones.push(o.name); });
    out.push('bones: ' + bones.join(', '));
    // try applying a clip
    const a = sk.mixer.clipAction(sk.clips.get('bail_knock'));
    a.reset().play();
    const hip = sk.b.get('Hips').bone;
    const before = hip.quaternion.toArray().map((v) => v.toFixed(3)).join(',');
    sk.mixer.update(0.5);
    const after = hip.quaternion.toArray().map((v) => v.toFixed(3)).join(',');
    out.push('hips before ' + before + ' after ' + after + ' pos ' + hip.position.toArray().map((v) => v.toFixed(3)).join(','));
    a.stop();
    return out.join('\n');
  });
  console.log(r);
}
