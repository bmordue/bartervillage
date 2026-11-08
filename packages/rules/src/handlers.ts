/**
 * Importing this module registers every order handler exactly once.
 */

import { registerBarterHandlers } from "./barter.js";
import { registerBuildingHandlers } from "./buildings.js";
import { registerCraftingHandlers } from "./crafting.js";
import { registerDecorationHandlers } from "./decorations.js";
import { registerDefaultHandlers } from "./defaults.js";
import { registerForageHandlers } from "./forage.js";

registerDefaultHandlers();
registerBuildingHandlers();
registerCraftingHandlers();
registerForageHandlers();
registerBarterHandlers();
registerDecorationHandlers();
