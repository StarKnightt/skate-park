export default async function (c) {
  const tag = process.env.TAG || 'portrait';
  await c.api('manual', true);
  await c.api('touch', true);
  await c.api('teleport', 9, 0, 3, 180, 0);
  await c.api('advance', 20);
  await c.shot(`screens/f_mobile_${tag}.png`);
  console.log(JSON.stringify(await c.api('state')));
}
