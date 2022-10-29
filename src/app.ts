import Robot from './robot/robot';

(async () => {
  await new Robot().start();

  console.log('Brobbot is running!');
})();