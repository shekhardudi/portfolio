import type { SolutionPlugin } from '../_types';
import meta from './meta';
import Demo from './Demo';
import Architecture from './Architecture';

const plugin: SolutionPlugin = {
  meta,
  Demo,
  Architecture,
};

export default plugin;
