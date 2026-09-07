import {Statement} from './Statement';
import {Stat} from './Stat';
import {Contrast} from './Contrast';
import {ListCard} from './ListCard';
import {Ring} from './Ring';
import {Odometer} from './Odometer';
import {Entity} from './Entity';
import {Curve} from './Curve';
import {Rank} from './Rank';

/** CardType → 组件。Task 3 的 CARD_TYPES 每一项都必须在这里有实现。 */
export const CARDS = {
  statement: Statement,
  stat: Stat,
  contrast: Contrast,
  list: ListCard,
  ring: Ring,
  odometer: Odometer,
  curve: Curve,
  rank: Rank,
  entity: Entity,
} as const;
