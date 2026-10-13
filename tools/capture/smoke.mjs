// quick smoke test: first frame + a few views
export default async function (c) {
  await c.api('manual', true);
  await c.api('advance', 20);
  await c.shot('dev/smoke_first.png');
  console.log(JSON.stringify(await c.api('state')));
  console.log('feet', JSON.stringify(await c.api('feetError')));
  // push forward for 2 s
  await c.api('hold', ['KeyW']);
  await c.api('advance', 60);
  await c.api('release');
  await c.api('advance', 10);
  console.log(JSON.stringify(await c.api('state')));
  await c.shot('dev/smoke_ride.png');
  await c.api('shot', 'halfpipe');
  await c.api('advance', 2);
  await c.shot('dev/smoke_hp.png');
  await c.api('shot', 'bowl');
  await c.api('advance', 2);
  await c.shot('dev/smoke_bowl.png');
}
