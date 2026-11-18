/**
 * Versioned content JSON validation (spec §12, M3.16).
 *
 * Content is authored as JSON and pinned per world. Validation is hand-written
 * so the rules package stays dependency-free and can run in the browser.
 */

import {
  GOAL_KINDS,
  ORDER_TYPES,
  SEASONS,
  WEATHERS,
  type AnimalDefinition,
  type BadgeDefinition,
  type BiomeDefinition,
  type BuildingDefinition,
  type ContentPack,
  type CropDefinition,
  type DecorationDefinition,
  type GoalDefinition,
  type PhraseDefinition,
  type RecipeDefinition,
  type WeatherDefinition,
  type WildNodeDefinition,
} from "./types.js";

export type ContentValidationResult =
  { ok: true; content: ContentPack } | { ok: false; errors: string[] };

class ValidationErrors {
  readonly #errors: string[] = [];

  add(path: string, message: string): void {
    this.#errors.push(`${path}: ${message}`);
  }

  get errors(): string[] {
    return this.#errors;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function requireArray(errors: ValidationErrors, path: string, value: unknown): unknown[] | null {
  if (!Array.isArray(value)) {
    errors.add(path, "must be an array");
    return null;
  }
  return value;
}

function requireRecord(
  errors: ValidationErrors,
  path: string,
  value: unknown,
): Record<string, unknown> | null {
  if (!isRecord(value)) {
    errors.add(path, "must be an object");
    return null;
  }
  return value;
}

function checkItemStacks(
  errors: ValidationErrors,
  path: string,
  value: unknown,
  items: ReadonlySet<string>,
): void {
  const list = requireArray(errors, path, value);
  if (!list) {
    return;
  }
  list.forEach((entry, index) => {
    const stack = requireRecord(errors, `${path}[${index}]`, entry);
    if (!stack) {
      return;
    }
    if (!isNonEmptyString(stack.item) || !items.has(stack.item)) {
      errors.add(`${path}[${index}].item`, "references an unknown item");
    }
    if (!isPositiveInteger(stack.quantity)) {
      errors.add(`${path}[${index}].quantity`, "must be a positive integer");
    }
  });
}

function collectIds<T extends { id: string }>(
  errors: ValidationErrors,
  path: string,
  list: unknown[],
  parse: (index: number, entry: unknown) => T | null,
): Map<string, T> {
  const byId = new Map<string, T>();
  list.forEach((entry, index) => {
    const parsed = parse(index, entry);
    if (!parsed) {
      return;
    }
    if (byId.has(parsed.id)) {
      errors.add(`${path}[${index}].id`, `duplicate id ${parsed.id}`);
    } else {
      byId.set(parsed.id, parsed);
    }
  });
  return byId;
}

function stringField(
  errors: ValidationErrors,
  path: string,
  record: Record<string, unknown>,
  field: string,
): string | null {
  const value = record[field];
  if (!isNonEmptyString(value)) {
    errors.add(`${path}.${field}`, "must be a non-empty string");
    return null;
  }
  return value;
}

function numberField(
  errors: ValidationErrors,
  path: string,
  record: Record<string, unknown>,
  field: string,
  predicate: (value: number) => boolean,
  message: string,
): number | null {
  const value = record[field];
  if (!isFiniteNumber(value) || !predicate(value)) {
    errors.add(`${path}.${field}`, message);
    return null;
  }
  return value;
}

function booleanField(
  errors: ValidationErrors,
  path: string,
  record: Record<string, unknown>,
  field: string,
): boolean | null {
  const value = record[field];
  if (typeof value !== "boolean") {
    errors.add(`${path}.${field}`, "must be a boolean");
    return null;
  }
  return value;
}

function parseSeasonList(errors: ValidationErrors, path: string, value: unknown): string[] {
  const list = requireArray(errors, path, value);
  if (!list) {
    return [];
  }
  if (list.length === 0) {
    errors.add(path, "must list at least one season");
  }
  list.forEach((season, index) => {
    if (typeof season !== "string" || !(SEASONS as readonly string[]).includes(season)) {
      errors.add(`${path}[${index}]`, `unknown season ${String(season)}`);
    }
  });
  return list.filter((season): season is string => typeof season === "string");
}

export function validateContent(input: unknown): ContentValidationResult {
  const errors = new ValidationErrors();
  const root = requireRecord(errors, "$", input);
  if (!root) {
    return { ok: false, errors: errors.errors };
  }

  const version = stringField(errors, "$", root, "version");

  const itemsRaw = requireRecord(errors, "$.items", root.items);
  const items = new Set<string>();
  if (itemsRaw) {
    for (const [itemId, definition] of Object.entries(itemsRaw)) {
      if (!isNonEmptyString(itemId)) {
        errors.add("$.items", "item ids must be non-empty strings");
      }
      const item = requireRecord(errors, `$.items.${itemId}`, definition);
      if (item) {
        stringField(errors, `$.items.${itemId}`, item, "name");
      }
      items.add(itemId);
    }
  }

  const energy = requireRecord(errors, "$.energy", root.energy);
  if (energy) {
    numberField(
      errors,
      "$.energy",
      energy,
      "dailyBudget",
      (v) => Number.isInteger(v) && v > 0,
      "must be a positive integer",
    );
    numberField(
      errors,
      "$.energy",
      energy,
      "travelPerBoundary",
      (v) => Number.isInteger(v) && v >= 0,
      "must be a non-negative integer",
    );
    const costs = requireRecord(errors, "$.energy.costs", energy.costs);
    if (costs) {
      for (const orderType of ORDER_TYPES) {
        numberField(
          errors,
          "$.energy.costs",
          costs,
          orderType,
          (v) => Number.isInteger(v) && v >= 0,
          "must be a non-negative integer",
        );
      }
    }
  }

  const goodwill = requireRecord(errors, "$.goodwill", root.goodwill);
  if (goodwill) {
    numberField(errors, "$.goodwill", goodwill, "gift", (v) => v >= 0, "must be non-negative");
    numberField(errors, "$.goodwill", goodwill, "help", (v) => v >= 0, "must be non-negative");
    const badgesRaw = requireArray(errors, "$.goodwill.badges", goodwill.badges) ?? [];
    collectIds(errors, "$.goodwill.badges", badgesRaw, (index, entry): BadgeDefinition | null => {
      const path = `$.goodwill.badges[${index}]`;
      const record = requireRecord(errors, path, entry);
      if (!record) {
        return null;
      }
      const id = stringField(errors, path, record, "id");
      stringField(errors, path, record, "name");
      const minScore = numberField(
        errors,
        path,
        record,
        "minScore",
        (v) => Number.isInteger(v) && v >= 0,
        "must be a non-negative integer",
      );
      return id && minScore !== null ? { id, name: String(record.name), minScore } : null;
    });
  }

  const cropsRaw = requireArray(errors, "$.crops", root.crops) ?? [];
  const crops = collectIds(errors, "$.crops", cropsRaw, (index, entry): CropDefinition | null => {
    const path = `$.crops[${index}]`;
    const record = requireRecord(errors, path, entry);
    if (!record) {
      return null;
    }
    const id = stringField(errors, path, record, "id");
    stringField(errors, path, record, "name");
    const growthTicks = numberField(
      errors,
      path,
      record,
      "growthTicks",
      (v) => Number.isInteger(v) && v >= 1 && v <= 7,
      "must be an integer from 1 to 7",
    );
    const seasons = parseSeasonList(errors, `${path}.seasons`, record.seasons);
    checkItemStacks(errors, `${path}.yield`, record.yield, items);
    const wateringRequired = booleanField(errors, path, record, "wateringRequired");
    const tendingRequired = booleanField(errors, path, record, "tendingRequired");
    const frostSensitive = booleanField(errors, path, record, "frostSensitive");
    const unlockedByDefault = booleanField(errors, path, record, "unlockedByDefault");
    if (
      !id ||
      growthTicks === null ||
      wateringRequired === null ||
      tendingRequired === null ||
      frostSensitive === null ||
      unlockedByDefault === null
    ) {
      return null;
    }
    return {
      id,
      name: String(record.name),
      growthTicks,
      seasons: seasons as CropDefinition["seasons"],
      yield: record.yield as CropDefinition["yield"],
      wateringRequired,
      tendingRequired,
      frostSensitive,
      unlockedByDefault,
    };
  });

  const animalsRaw = requireArray(errors, "$.animals", root.animals) ?? [];
  collectIds(errors, "$.animals", animalsRaw, (index, entry): AnimalDefinition | null => {
    const path = `$.animals[${index}]`;
    const record = requireRecord(errors, path, entry);
    if (!record) {
      return null;
    }
    const id = stringField(errors, path, record, "id");
    stringField(errors, path, record, "name");
    checkItemStacks(errors, `${path}.produces`, record.produces, items);
    if (!isNonEmptyString(record.feedItem) || !items.has(record.feedItem)) {
      errors.add(`${path}.feedItem`, "references an unknown item");
    }
    return id
      ? {
          id,
          name: String(record.name),
          produces: record.produces as AnimalDefinition["produces"],
          feedItem: String(record.feedItem),
        }
      : null;
  });

  const buildingsRaw = requireArray(errors, "$.buildings", root.buildings) ?? [];
  const buildings = collectIds(
    errors,
    "$.buildings",
    buildingsRaw,
    (index, entry): BuildingDefinition | null => {
      const path = `$.buildings[${index}]`;
      const record = requireRecord(errors, path, entry);
      if (!record) {
        return null;
      }
      const id = stringField(errors, path, record, "id");
      stringField(errors, path, record, "name");
      const maxLevel = numberField(
        errors,
        path,
        record,
        "maxLevel",
        (v) => Number.isInteger(v) && v >= 1,
        "must be a positive integer",
      );
      if (record.biomeLocks !== null) {
        const locks = requireArray(errors, `${path}.biomeLocks`, record.biomeLocks);
        locks?.forEach((lock, lockIndex) => {
          if (typeof lock !== "string") {
            errors.add(`${path}.biomeLocks[${lockIndex}]`, "must be a biome id");
          }
        });
      }
      const levelsRaw = requireArray(errors, `${path}.levels`, record.levels) ?? [];
      const levels = levelsRaw.map((levelEntry, levelIndex) => {
        const levelPath = `${path}.levels[${levelIndex}]`;
        const levelRecord = requireRecord(errors, levelPath, levelEntry);
        if (!levelRecord) {
          return null;
        }
        const level = numberField(
          errors,
          levelPath,
          levelRecord,
          "level",
          (v) => Number.isInteger(v) && v >= 1,
          "must be a positive integer",
        );
        checkItemStacks(errors, `${levelPath}.cost`, levelRecord.cost, items);
        numberField(
          errors,
          levelPath,
          levelRecord,
          "energyCost",
          (v) => Number.isInteger(v) && v >= 0,
          "must be a non-negative integer",
        );
        numberField(
          errors,
          levelPath,
          levelRecord,
          "durationTicks",
          (v) => Number.isInteger(v) && v >= 0,
          "must be a non-negative integer",
        );
        numberField(
          errors,
          levelPath,
          levelRecord,
          "storageCapacity",
          (v) => Number.isInteger(v) && v >= 0,
          "must be a non-negative integer",
        );
        const unlocks =
          requireArray(errors, `${levelPath}.unlocksRecipes`, levelRecord.unlocksRecipes) ?? [];
        unlocks.forEach((recipe, recipeIndex) => {
          if (typeof recipe !== "string") {
            errors.add(`${levelPath}.unlocksRecipes[${recipeIndex}]`, "must be a recipe id");
          }
        });
        return level === null
          ? null
          : {
              level,
              cost: levelRecord.cost as never,
              energyCost: Number(levelRecord.energyCost),
              durationTicks: Number(levelRecord.durationTicks),
              storageCapacity: Number(levelRecord.storageCapacity),
              unlocksRecipes: unlocks as string[],
            };
      });
      if (!id || maxLevel === null) {
        return null;
      }
      return {
        id,
        name: String(record.name),
        biomeLocks: (record.biomeLocks as string[] | null) ?? null,
        maxLevel,
        levels: levels.filter((level): level is NonNullable<typeof level> => level !== null),
      };
    },
  );

  const recipesRaw = requireArray(errors, "$.recipes", root.recipes) ?? [];
  const recipes = collectIds(
    errors,
    "$.recipes",
    recipesRaw,
    (index, entry): RecipeDefinition | null => {
      const path = `$.recipes[${index}]`;
      const record = requireRecord(errors, path, entry);
      if (!record) {
        return null;
      }
      const id = stringField(errors, path, record, "id");
      stringField(errors, path, record, "name");
      if (!isNonEmptyString(record.building)) {
        errors.add(`${path}.building`, "must be a building id");
      }
      const buildingLevel = numberField(
        errors,
        path,
        record,
        "buildingLevel",
        (v) => Number.isInteger(v) && v >= 1,
        "must be a positive integer",
      );
      checkItemStacks(errors, `${path}.inputs`, record.inputs, items);
      checkItemStacks(errors, `${path}.outputs`, record.outputs, items);
      numberField(
        errors,
        path,
        record,
        "durationTicks",
        (v) => Number.isInteger(v) && v >= 0,
        "must be a non-negative integer",
      );
      const unlockedByDefault = booleanField(errors, path, record, "unlockedByDefault");
      if (!id || buildingLevel === null || unlockedByDefault === null) {
        return null;
      }
      return {
        id,
        name: String(record.name),
        building: String(record.building),
        buildingLevel,
        inputs: record.inputs as RecipeDefinition["inputs"],
        outputs: record.outputs as RecipeDefinition["outputs"],
        durationTicks: Number(record.durationTicks),
        unlockedByDefault,
      };
    },
  );

  const biomesRaw = requireArray(errors, "$.biomes", root.biomes) ?? [];
  const biomes = collectIds(
    errors,
    "$.biomes",
    biomesRaw,
    (index, entry): BiomeDefinition | null => {
      const path = `$.biomes[${index}]`;
      const record = requireRecord(errors, path, entry);
      if (!record) {
        return null;
      }
      const id = stringField(errors, path, record, "id");
      stringField(errors, path, record, "name");
      const traits = requireRecord(errors, `${path}.traits`, record.traits);
      if (traits) {
        for (const trait of ["soil", "water", "light"] as const) {
          numberField(
            errors,
            `${path}.traits`,
            traits,
            trait,
            (v) => v >= 0 && v <= 100,
            "must be between 0 and 100",
          );
        }
      }
      return id
        ? { id, name: String(record.name), traits: record.traits as BiomeDefinition["traits"] }
        : null;
    },
  );

  const weatherRaw = requireArray(errors, "$.weather", root.weather) ?? [];
  const weather = collectIds<WeatherDefinition>(
    errors,
    "$.weather",
    weatherRaw,
    (index, entry): WeatherDefinition | null => {
      const path = `$.weather[${index}]`;
      const record = requireRecord(errors, path, entry);
      if (!record) {
        return null;
      }
      const id = record.id;
      if (typeof id !== "string" || !(WEATHERS as readonly string[]).includes(id)) {
        errors.add(`${path}.id`, "must be a known weather");
        return null;
      }
      stringField(errors, path, record, "name");
      const countsAsWatering = booleanField(errors, path, record, "countsAsWatering");
      numberField(
        errors,
        path,
        record,
        "failureChance",
        (v) => v >= 0 && v <= 1,
        "must be between 0 and 1",
      );
      const frostDamage = booleanField(errors, path, record, "frostDamage");
      if (countsAsWatering === null || frostDamage === null) {
        return null;
      }
      return {
        id: id as WeatherDefinition["id"],
        name: String(record.name),
        countsAsWatering,
        failureChance: Number(record.failureChance),
        frostDamage,
      };
    },
  );
  if (weather.size !== WEATHERS.length) {
    errors.add("$.weather", `must define exactly the weathers ${WEATHERS.join(", ")}`);
  }

  const goalsRaw = requireArray(errors, "$.goals", root.goals) ?? [];
  collectIds(errors, "$.goals", goalsRaw, (index, entry): GoalDefinition | null => {
    const path = `$.goals[${index}]`;
    const record = requireRecord(errors, path, entry);
    if (!record) {
      return null;
    }
    const id = stringField(errors, path, record, "id");
    if (
      typeof record.kind !== "string" ||
      !(GOAL_KINDS as readonly string[]).includes(record.kind)
    ) {
      errors.add(`${path}.kind`, "must be a known goal kind");
    }
    stringField(errors, path, record, "title");
    checkItemStacks(errors, `${path}.requires`, record.requires, items);
    const rewards = requireArray(errors, `${path}.rewards`, record.rewards) ?? [];
    rewards.forEach((reward, rewardIndex) => {
      const rewardRecord = requireRecord(errors, `${path}.rewards[${rewardIndex}]`, reward);
      if (!rewardRecord) {
        return;
      }
      const kinds = ["recipe", "crop", "building", "map_area", "wild_zone"];
      if (typeof rewardRecord.kind !== "string" || !kinds.includes(rewardRecord.kind)) {
        errors.add(`${path}.rewards[${rewardIndex}].kind`, "must be a known reward kind");
      }
      if (!isNonEmptyString(rewardRecord.id)) {
        errors.add(`${path}.rewards[${rewardIndex}].id`, "must be a non-empty string");
      }
    });
    const durationTicks = numberField(
      errors,
      path,
      record,
      "durationTicks",
      (v) => Number.isInteger(v) && v > 0,
      "must be a positive integer",
    );
    if (!id || durationTicks === null) {
      return null;
    }
    return {
      id,
      kind: record.kind as GoalDefinition["kind"],
      title: String(record.title),
      requires: record.requires as GoalDefinition["requires"],
      rewards: record.rewards as GoalDefinition["rewards"],
      durationTicks,
    };
  });

  const phrasesRaw = requireArray(errors, "$.phrases", root.phrases) ?? [];
  collectIds(errors, "$.phrases", phrasesRaw, (index, entry): PhraseDefinition | null => {
    const path = `$.phrases[${index}]`;
    const record = requireRecord(errors, path, entry);
    if (!record) {
      return null;
    }
    const id = stringField(errors, path, record, "id");
    stringField(errors, path, record, "text");
    return id ? { id, text: String(record.text) } : null;
  });

  const wildNodesRaw = requireArray(errors, "$.wildNodes", root.wildNodes) ?? [];
  collectIds(errors, "$.wildNodes", wildNodesRaw, (index, entry): WildNodeDefinition | null => {
    const path = `$.wildNodes[${index}]`;
    const record = requireRecord(errors, path, entry);
    if (!record) {
      return null;
    }
    const id = stringField(errors, path, record, "id");
    if (!isNonEmptyString(record.resource) || !items.has(record.resource)) {
      errors.add(`${path}.resource`, "references an unknown item");
    }
    numberField(
      errors,
      path,
      record,
      "capacity",
      (v) => Number.isInteger(v) && v > 0,
      "must be a positive integer",
    );
    numberField(
      errors,
      path,
      record,
      "regrowRate",
      (v) => Number.isInteger(v) && v > 0,
      "must be a positive integer",
    );
    return id
      ? {
          id,
          resource: String(record.resource),
          capacity: Number(record.capacity),
          regrowRate: Number(record.regrowRate),
        }
      : null;
  });

  const decorationsRaw = requireArray(errors, "$.decorations", root.decorations) ?? [];
  collectIds(
    errors,
    "$.decorations",
    decorationsRaw,
    (index, entry): DecorationDefinition | null => {
      const path = `$.decorations[${index}]`;
      const record = requireRecord(errors, path, entry);
      if (!record) {
        return null;
      }
      const id = stringField(errors, path, record, "id");
      stringField(errors, path, record, "name");
      checkItemStacks(errors, `${path}.cost`, record.cost, items);
      return id
        ? { id, name: String(record.name), cost: record.cost as DecorationDefinition["cost"] }
        : null;
    },
  );

  for (const [recipeId, recipe] of recipes) {
    const building = buildings.get(recipe.building);
    if (!building) {
      errors.add(`$.recipes.${recipeId}.building`, `unknown building ${recipe.building}`);
    } else if (recipe.buildingLevel > building.maxLevel) {
      errors.add(`$.recipes.${recipeId}.buildingLevel`, "exceeds the building's maxLevel");
    }
  }
  for (const [buildingId, building] of buildings) {
    if (building.levels.length !== building.maxLevel) {
      errors.add(`$.buildings.${buildingId}.levels`, "must define exactly maxLevel levels");
    }
    building.levels.forEach((level, index) => {
      if (level.level !== index + 1) {
        errors.add(
          `$.buildings.${buildingId}.levels[${index}].level`,
          "levels must be sequential from 1",
        );
      }
      for (const recipeId of level.unlocksRecipes) {
        if (!recipes.has(recipeId)) {
          errors.add(
            `$.buildings.${buildingId}.levels[${index}].unlocksRecipes`,
            `unknown recipe ${recipeId}`,
          );
        }
      }
    });
    for (const biome of building.biomeLocks ?? []) {
      if (!biomes.has(biome)) {
        errors.add(`$.buildings.${buildingId}.biomeLocks`, `unknown biome ${biome}`);
      }
    }
  }
  for (const goal of root.goals as GoalDefinition[]) {
    goal.rewards.forEach((reward, index) => {
      const valid =
        (reward.kind === "recipe" && recipes.has(reward.id)) ||
        (reward.kind === "crop" && crops.has(reward.id)) ||
        (reward.kind === "building" && buildings.has(reward.id)) ||
        reward.kind === "map_area" ||
        reward.kind === "wild_zone";
      if (!valid) {
        errors.add(
          `$.goals.${goal.id}.rewards[${index}].id`,
          `unknown ${reward.kind} ${reward.id}`,
        );
      }
    });
  }

  if (errors.errors.length > 0 || version === null) {
    return { ok: false, errors: errors.errors };
  }

  return {
    ok: true,
    content: {
      version,
      items: root.items as ContentPack["items"],
      energy: root.energy as ContentPack["energy"],
      goodwill: root.goodwill as ContentPack["goodwill"],
      crops: [...crops.values()],
      animals: [...(root.animals as AnimalDefinition[])],
      recipes: [...recipes.values()],
      buildings: [...buildings.values()],
      biomes: [...biomes.values()],
      weather: [...weather.values()],
      goals: root.goals as GoalDefinition[],
      phrases: root.phrases as PhraseDefinition[],
      wildNodes: root.wildNodes as WildNodeDefinition[],
      decorations: root.decorations as DecorationDefinition[],
    },
  };
}

export function parseContent(json: string): ContentValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return { ok: false, errors: [`$: invalid JSON: ${(error as Error).message}`] };
  }
  return validateContent(parsed);
}
