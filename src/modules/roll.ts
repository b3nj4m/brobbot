import crypto from 'crypto';
import Robot from '../robot/robot';

const maxRange = 4294967296  // 2^32
const maxIter  = 100

//rejection sampling; see: http://dimitri.xyz/random-ints-from-random-bits/
function getRandSample() {
  return crypto.randomBytes(4).readUInt32LE();
}

function unsafeCoerce(sample: number, range: number) {
  return sample % range;
}

function inExtendedRange(sample: number, range: number) {
  return sample < Math.floor(maxRange / range) * range;
}

function rejectionSampling(range: number) {
  var sample;
  var i = 0;
  do {
    sample = getRandSample();
    if (i >= maxIter) {
      console.error('brobbot-roll: too many iterations. Check your source of randomness.');
      break;
    }
    i++;
  } while (!inExtendedRange(sample, range));
  return unsafeCoerce(sample, range)
}

function getRandIntLessThan(range: number) {
  return rejectionSampling(Math.ceil(range));
}

function getRandIntInclusive(low: number, hi: number) {
  if (low <= hi) {
    const l = Math.ceil(low);
    const h = Math.floor(hi);
    return (l + getRandIntLessThan( h - l + 1));
  }
  return NaN;
}


const roll = (robot: Robot) => {
  robot.helpCommands("roll", [
    ["roll `dice`", "Roll `dice` and report the outcomes. E.g. `roll d20 + 4 2d6`"],
    ["skill-check `dc` `modifier`", "Roll a d20, add the modifier and report the outcome."],
  ]);

  robot.robotMessage(/^roll\s+(.+)/i, async ({say, match}) => {
    const dieRegex = /^([0-9]*d[0-9]+)\s*([+-]\s*[0-9]+)?\s*/i;
    let dice = match[1];
    if (dice) {
      const results = [];
      while (dieRegex.test(dice)) {
        let [matches, die, modifierString] = dieRegex.exec(dice) || [];
        const [numString, sizeString] = die.split('d');
        const num = numString ? Math.max(1, Math.min(Math.abs(parseInt(numString, 10)), 100)) : 1;
        const size = sizeString ? Math.max(2, Math.abs(parseInt(sizeString, 10))) : 20;
        const modifier = modifierString ? parseInt(modifierString.replace(/\s+/g, ''), 10) : 0;

        if (size && num) {
          let result = modifier;
          for (let i = 0; i < num; i++) {
            result += getRandIntInclusive(1, size);
          }

          const op = modifier < 0 ? '-' : '+';
          const roll = `${num}d${size}` + (modifier ? ` ${op} ${Math.abs(modifier)}` : '');
          results.push(`${roll}: ${result}`);
        }

        dice = dice.replace(dieRegex, '');
      }
      //TODO flavor text
      if (results.length > 0) {
        say(`Rolled ${results.join(', ')}`);
        return;
      }
    }
    say('no.');
  });

  robot.robotMessage(/^skill-check\s*([^\s]+)?\s*([^\s]+)?/i, async ({say, match}) => {
    let [matches, dcString, modString] = match;
    const dc = dcString ? parseInt(dcString, 10) : 10;
    const mod = modString ? parseInt(modString, 10) : 0;

    if (dc && (mod || mod === 0)) {
      const roll = getRandIntInclusive(1, 20);
      const success = roll + mod >= dc;
      const op = mod < 0 ? '-' : '+';
      let text;
      //TODO flavor text
      if (roll === 1) {
        text = 'critical failure!';
      }
      else if (roll === 20) {
        text = 'critical success!';
      }
      else if (success) {
        text = 'you passed.';
      }
      else {
        text = 'you failed.';
      }
      say(`DC ${dc} skill check: ${text} (${roll} ${op} ${Math.abs(mod)})`);
    }
    else {
      say('Wat.');
    }
  });
};

export default roll;