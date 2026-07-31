'use strict';

const {
    structure,
    spawn,
    tower,
    extension,
    container,
    storage,
    road,
    wall,
    rampart,
    link,
    terminal,
    observer,
    powerSpawn,
    extractor,
    lab,
    nuker,
    factory,
    invaderCore,
    powerBank,
    portal,
    keeperLair,
    source,
    controller,
    creep,
    invader,
    dummyTarget,
} = require('../src/lib/builders/spec');

const {
    STRUCTURE_SPAWN,
    STRUCTURE_TOWER,
    STRUCTURE_EXTENSION,
    STRUCTURE_CONTAINER,
    STRUCTURE_STORAGE,
    STRUCTURE_ROAD,
    STRUCTURE_WALL,
    STRUCTURE_RAMPART,
    STRUCTURE_LINK,
    STRUCTURE_TERMINAL,
    STRUCTURE_OBSERVER,
    STRUCTURE_POWER_SPAWN,
    STRUCTURE_EXTRACTOR,
    STRUCTURE_LAB,
    STRUCTURE_NUKER,
    STRUCTURE_FACTORY,
    STRUCTURE_INVADER_CORE,
    STRUCTURE_POWER_BANK,
    STRUCTURE_PORTAL,
    STRUCTURE_KEEPER_LAIR,
} = require('../src/constants/screepsConstants');

describe('spec constructors', () => {
    describe('structure()', () => {
        it('returns object with type, x, y', () => {
            const s = structure(STRUCTURE_SPAWN, 10, 20);
            expect(s).toMatchObject({ type: STRUCTURE_SPAWN, x: 10, y: 20 });
        });

        it('sets default store/hits for spawn', () => {
            const s = structure(STRUCTURE_SPAWN, 25, 25);
            expect(s.store).toEqual({ energy: 300 });
            expect(s.storeCapacityResource).toEqual({ energy: 300 });
            expect(s.hits).toBe(15000);
            expect(s.hitsMax).toBe(15000);
            expect(s.notifyWhenAttacked).toBe(true);
        });

        it('defaults for tower', () => {
            const s = structure(STRUCTURE_TOWER, 25, 25);
            expect(s.store).toEqual({ energy: 1000 });
            expect(s.hits).toBe(3000);
        });

        it('defaults for extension', () => {
            const s = structure(STRUCTURE_EXTENSION, 25, 25);
            expect(s.store).toEqual({ energy: 50 });
            expect(s.hits).toBe(1000);
        });

        it('defaults for container', () => {
            const s = structure(STRUCTURE_CONTAINER, 25, 25);
            expect(s.store).toEqual({ energy: 2000 });
            expect(s.hits).toBe(250000);
            expect(s.nextDecayTime).toBe(100);
        });

        it('defaults for storage', () => {
            const s = structure(STRUCTURE_STORAGE, 25, 25);
            expect(s.store).toEqual({ energy: 10000 });
            expect(s.storeCapacity).toBe(1000000);
            expect(s.storeCapacityResource).toBeUndefined();
            expect(s.hits).toBe(10000);
        });

        it('defaults for road (no store)', () => {
            const s = structure(STRUCTURE_ROAD, 25, 25);
            expect(s.store).toBeUndefined();
            expect(s.hits).toBe(5000);
            expect(s.notifyWhenAttacked).toBeUndefined();
            expect(s.nextDecayTime).toBe(1000);
        });

        it('defaults for wall', () => {
            const s = structure(STRUCTURE_WALL, 25, 25);
            expect(s.hits).toBe(10000);
            expect(s.hitsMax).toBe(300000000);
        });

        it('defaults for rampart', () => {
            const s = structure(STRUCTURE_RAMPART, 25, 25);
            expect(s.hits).toBe(10000);
            expect(s.notifyWhenAttacked).toBe(true);
            expect(s.nextDecayTime).toBe(100);
        });

        it('overrides.roomName is set', () => {
            const s = structure(STRUCTURE_SPAWN, 10, 20, { roomName: 'W0N1' });
            expect(s.roomName).toBe('W0N1');
        });

        it('overrides.userId is set', () => {
            const s = structure(STRUCTURE_SPAWN, 10, 20, { userId: 'u1' });
            expect(s.userId).toBe('u1');
        });

        it('overrides.userId = null is preserved', () => {
            const s = structure(STRUCTURE_SPAWN, 10, 20, { userId: null });
            expect(s.userId).toBeNull();
        });

        it('store merges with defaults', () => {
            const s = structure(STRUCTURE_SPAWN, 10, 20, { store: { energy: 500 } });
            expect(s.store).toEqual({ energy: 500 });
        });

        it('storeCapacityResource merges with defaults', () => {
            const s = structure(STRUCTURE_SPAWN, 10, 20, { storeCapacityResource: { energy: 600 } });
            expect(s.storeCapacityResource).toEqual({ energy: 600 });
        });

        it('hits can be overridden', () => {
            const s = structure(STRUCTURE_SPAWN, 10, 20, { hits: 5000 });
            expect(s.hits).toBe(5000);
            expect(s.hitsMax).toBe(15000);
        });

        it('hitsMax can be overridden', () => {
            const s = structure(STRUCTURE_SPAWN, 10, 20, { hitsMax: 20000 });
            expect(s.hits).toBe(15000);
            expect(s.hitsMax).toBe(20000);
        });

        it('id is set', () => {
            const s = structure(STRUCTURE_SPAWN, 10, 20, { id: 'abc123' });
            expect(s.id).toBe('abc123');
        });

        it('name is set', () => {
            const s = structure(STRUCTURE_SPAWN, 10, 20, { name: 'Spawn1' });
            expect(s.name).toBe('Spawn1');
        });

        it('overrides arbitrary fields', () => {
            const s = structure(STRUCTURE_SPAWN, 10, 20, { overrides: { custom: true } });
            expect(s.overrides).toEqual({ custom: true });
        });

        it('unknown type does not add store', () => {
            const s = structure('unknown_type', 10, 20);
            expect(s.store).toBeUndefined();
            expect(s.storeCapacityResource).toBeUndefined();
        });

        it('notifyWhenAttacked can be overridden', () => {
            const s = structure(STRUCTURE_SPAWN, 10, 20, { notifyWhenAttacked: false });
            expect(s.notifyWhenAttacked).toBe(false);
        });

        it('nextDecayTime is undefined for non-decaying structures', () => {
            const s = structure(STRUCTURE_SPAWN, 10, 20);
            expect(s.nextDecayTime).toBeUndefined();
        });

        it('nextDecayTime can be overridden', () => {
            const s = structure(STRUCTURE_ROAD, 10, 20, { nextDecayTime: 500 });
            expect(s.nextDecayTime).toBe(500);
        });
    });

    describe('spawn()', () => {
        it('creates spawn with type', () => {
            const s = spawn(25, 25);
            expect(s.type).toBe(STRUCTURE_SPAWN);
        });

        it('generates a name if not provided', () => {
            const s = spawn(25, 25);
            expect(s.name).toBeDefined();
            expect(typeof s.name).toBe('string');
        });

        it('uses provided name', () => {
            const s = spawn(25, 25, { name: 'S1' });
            expect(s.name).toBe('S1');
        });

        it('energy can be overridden', () => {
            const s = spawn(25, 25, { energy: 500 });
            expect(s.store.energy).toBe(500);
        });

        it('storeCapacity can be overridden', () => {
            const s = spawn(25, 25, { storeCapacity: 1000 });
            expect(s.storeCapacity).toBe(1000);
        });

        it('hits can be overridden', () => {
            const s = spawn(25, 25, { hits: 5000 });
            expect(s.hits).toBe(5000);
            expect(s.hitsMax).toBe(5000);
        });

        it('id, userId, roomName are passed', () => {
            const s = spawn(25, 25, { id: 's1', userId: 'u1', roomName: 'W0N1' });
            expect(s.id).toBe('s1');
            expect(s.userId).toBe('u1');
            expect(s.roomName).toBe('W0N1');
        });

        it('userId = null is preserved', () => {
            const s = spawn(25, 25, { userId: null });
            expect(s.userId).toBeNull();
        });
    });

    describe('tower()', () => {
        it('creates tower with type', () => {
            const t = tower(10, 20);
            expect(t.type).toBe(STRUCTURE_TOWER);
            expect(t.store).toEqual({ energy: 1000 });
            expect(t.storeCapacity).toBe(1000);
            expect(t.storeCapacityResource).toEqual({ energy: 1000 });
            expect(t.hits).toBe(3000);
        });

        it('energy and storeCapacityResource can be overridden', () => {
            const t = tower(10, 20, { energy: 500, storeCapacityResource: { energy: 500 } });
            expect(t.store.energy).toBe(500);
            expect(t.storeCapacityResource.energy).toBe(500);
        });

        it('storeCapacity can be overridden', () => {
            const t = tower(10, 20, { storeCapacity: 500 });
            expect(t.storeCapacity).toBe(500);
        });

        it('hits can be overridden', () => {
            const t = tower(10, 20, { hits: 1500 });
            expect(t.hits).toBe(1500);
            expect(t.hitsMax).toBe(1500);
        });
    });

    describe('extension()', () => {
        it('creates extension', () => {
            const e = extension(10, 20);
            expect(e.type).toBe(STRUCTURE_EXTENSION);
            expect(e.store).toEqual({ energy: 50 });
            expect(e.storeCapacity).toBe(50);
            expect(e.storeCapacityResource).toEqual({ energy: 50 });
            expect(e.hits).toBe(1000);
            expect(e.hitsMax).toBe(1000);
        });

        it('storeCapacity can be overridden', () => {
            const e = extension(10, 20, { storeCapacity: 100 });
            expect(e.storeCapacity).toBe(100);
        });

        it('hits can be overridden', () => {
            const e = extension(10, 20, { hits: 500 });
            expect(e.hits).toBe(500);
            expect(e.hitsMax).toBe(500);
        });

        it('storeCapacityResource can be overridden', () => {
            const e = extension(10, 20, { storeCapacityResource: { energy: 100 } });
            expect(e.storeCapacityResource).toEqual({ energy: 100 });
        });
    });

    describe('container()', () => {
        it('creates container', () => {
            const c = container(10, 20);
            expect(c.type).toBe(STRUCTURE_CONTAINER);
            expect(c.store).toEqual({ energy: 2000 });
            expect(c.storeCapacity).toBe(2000);
            expect(c.hits).toBe(250000);
        });

        it('storeCapacity can be overridden', () => {
            const c = container(10, 20, { storeCapacity: 1000 });
            expect(c.storeCapacity).toBe(1000);
        });

        it('hits can be overridden', () => {
            const c = container(10, 20, { hits: 100000 });
            expect(c.hits).toBe(100000);
            expect(c.hitsMax).toBe(100000);
        });

        it('storeCapacityResource is ignored (simple mode)', () => {
            const c = container(10, 20, { storeCapacityResource: { energy: 500 } });
            expect(c.storeCapacityResource).toBeUndefined();
        });
    });

    describe('storage()', () => {
        it('creates storage', () => {
            const s = storage(10, 20);
            expect(s.type).toBe(STRUCTURE_STORAGE);
            expect(s.store).toEqual({ energy: 10000 });
            expect(s.storeCapacity).toBe(1000000);
            expect(s.hits).toBe(10000);
            expect(s.hitsMax).toBe(10000);
        });

        it('hits can be overridden', () => {
            const s = storage(10, 20, { hits: 5000 });
            expect(s.hits).toBe(5000);
            expect(s.hitsMax).toBe(5000);
        });

        it('storeCapacityResource is ignored (simple mode)', () => {
            const s = storage(10, 20, { storeCapacityResource: { energy: 500000 } });
            expect(s.storeCapacityResource).toBeUndefined();
        });
    });

    describe('road()', () => {
        it('creates road', () => {
            const r = road(10, 20);
            expect(r.type).toBe(STRUCTURE_ROAD);
            expect(r.hits).toBe(5000);
            expect(r.hitsMax).toBe(5000);
        });

        it('hits can be overridden', () => {
            const r = road(10, 20, { hits: 2500 });
            expect(r.hits).toBe(2500);
            expect(r.hitsMax).toBe(2500);
        });
    });

    describe('wall()', () => {
        it('creates wall', () => {
            const w = wall(10, 20);
            expect(w.type).toBe(STRUCTURE_WALL);
        });

        it('hits can be overridden', () => {
            const w = wall(10, 20, { hits: 50000 });
            expect(w.hits).toBe(50000);
        });
    });

    describe('rampart()', () => {
        it('creates rampart', () => {
            const r = rampart(10, 20);
            expect(r.type).toBe(STRUCTURE_RAMPART);
            expect(r.hits).toBe(10000);
            expect(r.hitsMax).toBe(300000000);
        });

        it('hits can be overridden (hitsMax stays default)', () => {
            const r = rampart(10, 20, { hits: 50000 });
            expect(r.hits).toBe(50000);
            expect(r.hitsMax).toBe(300000000); // default from STRUCTURE_DEFAULTS
        });
    });

    // ─── New structures (observer, powerSpawn, extractor, lab, nuker, factory,
    //      invaderCore, powerBank, portal, keeperLair) ──────────────────────

    describe('structure() defaults — new types', () => {
        it('defaults for observer', () => {
            const s = structure(STRUCTURE_OBSERVER, 10, 20);
            expect(s.hits).toBe(500);
            expect(s.hitsMax).toBe(500);
            expect(s.notifyWhenAttacked).toBe(true);
            expect(s.store).toBeUndefined();
        });

        it('defaults for powerSpawn', () => {
            const s = structure(STRUCTURE_POWER_SPAWN, 10, 20);
            expect(s.store).toEqual({ energy: 5000, power: 100 });
            expect(s.storeCapacity).toBe(5000);
            expect(s.hits).toBe(5000);
            expect(s.hitsMax).toBe(5000);
            expect(s.notifyWhenAttacked).toBe(true);
        });

        it('defaults for extractor', () => {
            const s = structure(STRUCTURE_EXTRACTOR, 10, 20);
            expect(s.hits).toBe(500);
            expect(s.hitsMax).toBe(500);
            expect(s.notifyWhenAttacked).toBe(true);
            expect(s.store).toBeUndefined();
        });

        it('defaults for lab', () => {
            const s = structure(STRUCTURE_LAB, 10, 20);
            expect(s.store).toEqual({});
            expect(s.storeCapacity).toBe(3000);
            expect(s.hits).toBe(500);
            expect(s.hitsMax).toBe(500);
            expect(s.notifyWhenAttacked).toBe(true);
        });

        it('defaults for nuker', () => {
            const s = structure(STRUCTURE_NUKER, 10, 20);
            expect(s.store).toEqual({ energy: 0, G: 0 });
            expect(s.storeCapacity).toBe(300000);
            expect(s.hits).toBe(1000);
            expect(s.hitsMax).toBe(1000);
            expect(s.notifyWhenAttacked).toBe(true);
        });

        it('defaults for factory', () => {
            const s = structure(STRUCTURE_FACTORY, 10, 20);
            expect(s.store).toEqual({});
            expect(s.storeCapacity).toBe(50000);
            expect(s.hits).toBe(1000);
            expect(s.hitsMax).toBe(1000);
            expect(s.notifyWhenAttacked).toBe(true);
        });

        it('defaults for invaderCore', () => {
            const s = structure(STRUCTURE_INVADER_CORE, 10, 20);
            expect(s.hits).toBe(100000);
            expect(s.hitsMax).toBe(100000);
            expect(s.notifyWhenAttacked).toBeUndefined();
            expect(s.store).toBeUndefined();
            // note: userId is set by the constructor, not by structure() defaults
        });

        it('defaults for powerBank', () => {
            const s = structure(STRUCTURE_POWER_BANK, 10, 20);
            expect(s.hits).toBe(2000000);
            expect(s.hitsMax).toBe(2000000);
            expect(s.store).toBeUndefined();
        });

        it('defaults for portal (indestructible, no hits)', () => {
            const s = structure(STRUCTURE_PORTAL, 10, 20);
            expect(s.type).toBe(STRUCTURE_PORTAL);
            expect(s.hits).toBeUndefined();
            expect(s.hitsMax).toBeUndefined();
            expect(s.store).toBeUndefined();
        });

        it('defaults for keeperLair', () => {
            const s = structure(STRUCTURE_KEEPER_LAIR, 10, 20);
            expect(s.hits).toBe(10000);
            expect(s.hitsMax).toBe(10000);
            expect(s.store).toBeUndefined();
        });
    });

    describe('observer()', () => {
        it('creates observer', () => {
            const o = observer(10, 20);
            expect(o.type).toBe(STRUCTURE_OBSERVER);
            expect(o.hits).toBe(500);
            expect(o.hitsMax).toBe(500);
        });

        it('observeRoom is passed via overrides', () => {
            const o = observer(10, 20, { observeRoom: 'W1N1' });
            expect(o.overrides).toEqual({ observeRoom: 'W1N1' });
        });

        it('observeRoom merges with existing overrides', () => {
            const o = observer(10, 20, { observeRoom: 'W1N1', overrides: { custom: true } });
            expect(o.overrides).toEqual({ custom: true, observeRoom: 'W1N1' });
        });

        it('userId is passed', () => {
            const o = observer(10, 20, { userId: 'u1' });
            expect(o.userId).toBe('u1');
        });
    });

    describe('powerSpawn()', () => {
        it('creates powerSpawn', () => {
            const ps = powerSpawn(10, 20);
            expect(ps.type).toBe(STRUCTURE_POWER_SPAWN);
            expect(ps.store).toEqual({ energy: 5000, power: 100 });
            expect(ps.storeCapacity).toBe(5000);
            expect(ps.hits).toBe(5000);
        });

        it('power is passed via overrides', () => {
            const ps = powerSpawn(10, 20, { power: 50 });
            expect(ps.overrides).toEqual({ power: 50 });
        });

        it('energy can be overridden', () => {
            const ps = powerSpawn(10, 20, { energy: 2000 });
            expect(ps.store.energy).toBe(2000);
        });
    });

    describe('extractor()', () => {
        it('creates extractor', () => {
            const e = extractor(10, 20);
            expect(e.type).toBe(STRUCTURE_EXTRACTOR);
            expect(e.hits).toBe(500);
            expect(e.hitsMax).toBe(500);
        });

        it('cooldown is passed via overrides', () => {
            const e = extractor(10, 20, { cooldown: 5 });
            expect(e.overrides).toEqual({ cooldown: 5 });
        });

        it('userId is passed', () => {
            const e = extractor(10, 20, { userId: 'u1' });
            expect(e.userId).toBe('u1');
        });
    });

    describe('lab()', () => {
        it('creates lab', () => {
            const l = lab(10, 20);
            expect(l.type).toBe(STRUCTURE_LAB);
            expect(l.store).toEqual({});
            expect(l.storeCapacity).toBe(3000);
            expect(l.hits).toBe(500);
        });

        it('cooldown and mineralType are passed via overrides', () => {
            const l = lab(10, 20, { cooldown: 3, mineralType: 'H' });
            expect(l.overrides).toEqual({ cooldown: 3, mineralType: 'H' });
        });

        it('energy can be placed in store', () => {
            const l = lab(10, 20, { energy: 1000 });
            expect(l.store.energy).toBe(1000);
        });
    });

    describe('nuker()', () => {
        it('creates nuker', () => {
            const n = nuker(10, 20);
            expect(n.type).toBe(STRUCTURE_NUKER);
            expect(n.store).toEqual({ energy: 0, G: 0 });
            expect(n.storeCapacity).toBe(300000);
            expect(n.hits).toBe(1000);
        });

        it('cooldown is passed via overrides', () => {
            const n = nuker(10, 20, { cooldown: 10000 });
            expect(n.overrides).toEqual({ cooldown: 10000 });
        });

        it('energy and G can be set via overrides', () => {
            const n = nuker(10, 20, { overrides: { cooldown: 0 } });
            expect(n.overrides).toEqual({ cooldown: 0 });
        });
    });

    describe('factory()', () => {
        it('creates factory', () => {
            const f = factory(10, 20);
            expect(f.type).toBe(STRUCTURE_FACTORY);
            expect(f.store).toEqual({});
            expect(f.storeCapacity).toBe(50000);
            expect(f.hits).toBe(1000);
        });

        it('level and cooldown are passed via overrides', () => {
            const f = factory(10, 20, { level: 3, cooldown: 10 });
            expect(f.overrides).toEqual({ level: 3, cooldown: 10 });
        });

        it('merges with existing overrides', () => {
            const f = factory(10, 20, { level: 2, overrides: { custom: 'x' } });
            expect(f.overrides).toEqual({ custom: 'x', level: 2 });
        });
    });

    describe('invaderCore()', () => {
        it('creates invaderCore with Invader userId', () => {
            const ic = invaderCore(10, 20);
            expect(ic.type).toBe(STRUCTURE_INVADER_CORE);
            expect(ic.hits).toBe(100000);
            expect(ic.hitsMax).toBe(100000);
            expect(ic.userId).toBe('2'); // Invader faction
        });

        it('level and ticksToDeploy are passed via overrides', () => {
            const ic = invaderCore(10, 20, { level: 2, ticksToDeploy: 100 });
            expect(ic.overrides).toEqual({ level: 2, ticksToDeploy: 100 });
        });
    });

    describe('powerBank()', () => {
        it('creates powerBank (neutral)', () => {
            const pb = powerBank(10, 20);
            expect(pb.type).toBe(STRUCTURE_POWER_BANK);
            expect(pb.hits).toBe(2000000);
            expect(pb.hitsMax).toBe(2000000);
            expect(pb.userId).toBeNull(); // neutral
        });

        it('power and ticksToDecay are passed via overrides', () => {
            const pb = powerBank(10, 20, { power: 3000, ticksToDecay: 2000 });
            expect(pb.overrides).toEqual({ power: 3000, ticksToDecay: 2000 });
        });
    });

    describe('portal()', () => {
        it('creates portal (neutral)', () => {
            const p = portal(10, 20);
            expect(p.type).toBe(STRUCTURE_PORTAL);
            expect(p.hits).toBeUndefined();
            expect(p.hitsMax).toBeUndefined();
            expect(p.userId).toBeNull(); // neutral
        });

        it('destination and unstableDate are passed via overrides', () => {
            const p = portal(10, 20, { destination: { x: 35, y: 35, room: 'W1N1' }, unstableDate: 50000 });
            expect(p.overrides).toEqual({ destination: { x: 35, y: 35, room: 'W1N1' }, unstableDate: 50000 });
        });
    });

    describe('keeperLair()', () => {
        it('creates keeperLair with Source Keeper userId', () => {
            const kl = keeperLair(10, 20);
            expect(kl.type).toBe(STRUCTURE_KEEPER_LAIR);
            expect(kl.hits).toBe(10000);
            expect(kl.hitsMax).toBe(10000);
            expect(kl.userId).toBe('3'); // Source Keeper faction
        });

        it('ticksToSpawn is passed via overrides', () => {
            const kl = keeperLair(10, 20, { ticksToSpawn: 150 });
            expect(kl.overrides).toEqual({ ticksToSpawn: 150 });
        });
    });

    describe('source()', () => {
        it('creates source with default energy', () => {
            const s = source(15, 15);
            expect(s).toMatchObject({ x: 15, y: 15, energy: 3000, energyCapacity: 3000, ticksToRegeneration: 0 });
        });

        it('energy and id can be overridden', () => {
            const s = source(15, 15, {
                energy: 1000,
                energyCapacity: 2000,
                ticksToRegeneration: 10,
                id: 'src1',
                roomName: 'W0N1',
            });
            expect(s).toMatchObject({
                energy: 1000,
                energyCapacity: 2000,
                ticksToRegeneration: 10,
                id: 'src1',
                roomName: 'W0N1',
            });
        });
    });

    describe('controller()', () => {
        it('creates controller with default (35,35) and level 1', () => {
            const c = controller();
            expect(c).toMatchObject({ x: 35, y: 35, level: 1, progress: 0, safeMode: 0 });
        });

        it('all fields can be overridden', () => {
            const c = controller({
                x: 10,
                y: 20,
                level: 5,
                progress: 5000,
                id: 'ctrl1',
                userId: 'u1',
                roomName: 'W0N1',
                safeMode: 1000,
                safeModeAvailable: 1,
                isPowerEnabled: true,
                downgradeTime: 5000,
            });
            expect(c).toMatchObject({
                x: 10,
                y: 20,
                level: 5,
                progress: 5000,
                id: 'ctrl1',
                userId: 'u1',
                roomName: 'W0N1',
                safeMode: 1000,
                safeModeAvailable: 1,
                isPowerEnabled: true,
                downgradeTime: 5000,
            });
        });

        it('supports positional (x, y) overload like other spec constructors', () => {
            const c = controller(10, 20);
            expect(c).toMatchObject({ x: 10, y: 20, level: 1, progress: 0, safeMode: 0 });
        });

        it('supports positional (x, y, opts) overload', () => {
            const c = controller(10, 20, { level: 5, progress: 100 });
            expect(c).toMatchObject({ x: 10, y: 20, level: 5, progress: 100 });
        });

        it('opts.x overrides positional x in overload', () => {
            const c = controller(10, 20, { x: 30 });
            expect(c).toMatchObject({ x: 30, y: 20 });
        });

        it('opts.y overrides positional y in overload', () => {
            const c = controller(10, 20, { y: 40 });
            expect(c).toMatchObject({ x: 10, y: 40 });
        });

        it('positional overload works with all extra fields', () => {
            const c = controller(5, 8, {
                level: 3,
                id: 'ctrl-pos',
                userId: 'user1',
                roomName: 'E1S1',
                downgradeTime: 100,
            });
            expect(c).toMatchObject({
                x: 5,
                y: 8,
                level: 3,
                id: 'ctrl-pos',
                userId: 'user1',
                roomName: 'E1S1',
                downgradeTime: 100,
            });
        });
    });

    describe('creep()', () => {
        it('creates creep with default body', () => {
            const c = creep(10, 20);
            expect(c.x).toBe(10);
            expect(c.y).toBe(20);
            expect(c.body).toHaveLength(6);
            expect(c.hits).toBe(900);
            expect(c.hitsMax).toBe(900);
        });

        it('creates creep with custom body', () => {
            const body = [{ type: 'work', hits: 150 }];
            const c = creep(10, 20, { body });
            expect(c.body).toEqual(body);
            expect(c.hits).toBe(150);
        });

        it('id and roomName are passed', () => {
            const c = creep(10, 20, { id: 'cr1', roomName: 'W0N1', userId: 'u1', name: 'Harvester1' });
            expect(c.id).toBe('cr1');
            expect(c.roomName).toBe('W0N1');
            expect(c.userId).toBe('u1');
            expect(c.name).toBe('Harvester1');
        });

        it('default body (no CARRY) has store={energy:0} and storeCapacity=0', () => {
            const c = creep(10, 20);
            expect(c.store).toEqual({ energy: 0 });
            expect(c.storeCapacity).toBe(0);
            expect(c.storeCapacityResource).toBeUndefined();
        });

        it('1x CARRY gives store={energy:0} and storeCapacity=50', () => {
            const body = [
                { type: 'carry', hits: 100 },
                { type: 'move', hits: 100 },
            ];
            const c = creep(10, 20, { body });
            expect(c.store).toEqual({ energy: 0 });
            expect(c.storeCapacity).toBe(50);
            expect(c.storeCapacityResource).toBeUndefined();
        });

        it('2x CARRY gives store={energy:0} and storeCapacity=100', () => {
            const body = [
                { type: 'carry', hits: 100 },
                { type: 'carry', hits: 100 },
                { type: 'move', hits: 100 },
            ];
            const c = creep(10, 20, { body });
            expect(c.store).toEqual({ energy: 0 });
            expect(c.storeCapacity).toBe(100);
            expect(c.storeCapacityResource).toBeUndefined();
        });

        it('store can be overridden via opts', () => {
            const body = [
                { type: 'carry', hits: 100 },
                { type: 'move', hits: 100 },
            ];
            const c = creep(10, 20, { body, store: { energy: 25 } });
            expect(c.store).toEqual({ energy: 25 });
            expect(c.storeCapacity).toBe(50);
        });

        it('storeCapacityResource can be overridden via opts', () => {
            const body = [
                { type: 'carry', hits: 100 },
                { type: 'move', hits: 100 },
            ];
            const c = creep(10, 20, { body, storeCapacityResource: { energy: 100 } });
            expect(c.storeCapacityResource).toEqual({ energy: 100 });
        });

        it('storeCapacityResource is not created automatically (only via opts)', () => {
            const body = [
                { type: 'carry', hits: 100 },
                { type: 'carry', hits: 100 },
                { type: 'move', hits: 100 },
            ];
            const c = creep(10, 20, { body });
            expect(c.storeCapacity).toBe(100);
            expect(c.storeCapacityResource).toBeUndefined();
        });

        it('storeCapacityResource can be set with multiple resources via opts', () => {
            const body = [
                { type: 'carry', hits: 100 },
                { type: 'move', hits: 100 },
            ];
            const c = creep(10, 20, { body, storeCapacityResource: { energy: 50, mineral: 50 } });
            expect(c.storeCapacityResource).toEqual({ energy: 50, mineral: 50 });
        });

        it('storeCapacity can be overridden via opts', () => {
            const body = [
                { type: 'carry', hits: 100 },
                { type: 'move', hits: 100 },
            ];
            const c = creep(10, 20, { body, storeCapacity: 200 });
            expect(c.storeCapacity).toBe(200);
            expect(c.storeCapacityResource).toBeUndefined();
            expect(c.store.energy).toBe(0);
        });
    });

    describe('invader()', () => {
        it('creates invader with userId=2', () => {
            const inv = invader(10, 20);
            expect(inv.userId).toBe('2');
            expect(inv.name).toBe('Invader_1');
            expect(inv.body).toHaveLength(6);
        });

        it('name and body can be overridden', () => {
            const body = [{ type: 'attack', hits: 150 }];
            const inv = invader(10, 20, { name: 'CustomInv', body });
            expect(inv.name).toBe('CustomInv');
            expect(inv.body).toEqual(body);
        });
    });

    describe('dummyTarget()', () => {
        it('creates dummy target creep', () => {
            const d = dummyTarget(10, 20);
            expect(d.name).toBe('DummyTarget');
            expect(d.userId).toBeUndefined();
        });

        it('name can be overridden', () => {
            const d = dummyTarget(10, 20, { name: 'Target', roomName: 'W0N1' });
            expect(d.name).toBe('Target');
            expect(d.roomName).toBe('W0N1');
        });
    });

    describe('link()', () => {
        it('creates link with type', () => {
            const l = link(25, 25);
            expect(l.type).toBe(STRUCTURE_LINK);
            expect(l.store).toEqual({ energy: 800 });
            expect(l.storeCapacity).toBe(800);
            expect(l.storeCapacityResource).toEqual({ energy: 800 });
            expect(l.hits).toBe(1000);
            expect(l.notifyWhenAttacked).toBe(true);
        });

        it('energy and storeCapacity can be overridden', () => {
            const l = link(10, 20, { energy: 400, storeCapacity: 400 });
            expect(l.store.energy).toBe(400);
            expect(l.storeCapacity).toBe(400);
        });

        it('hits can be overridden', () => {
            const l = link(10, 20, { hits: 500 });
            expect(l.hits).toBe(500);
            expect(l.hitsMax).toBe(500);
        });

        it('storeCapacityResource can be overridden', () => {
            const l = link(10, 20, { storeCapacityResource: { energy: 400 } });
            expect(l.storeCapacityResource).toEqual({ energy: 400 });
        });
    });

    describe('terminal()', () => {
        it('creates terminal with type', () => {
            const t = terminal(25, 25);
            expect(t.type).toBe(STRUCTURE_TERMINAL);
            expect(t.store).toEqual({ energy: 0 });
            expect(t.storeCapacity).toBe(300000);
            expect(t.storeCapacityResource).toBeUndefined();
            expect(t.hits).toBe(3000);
            expect(t.notifyWhenAttacked).toBe(true);
        });

        it('energy and storeCapacity can be overridden', () => {
            const t = terminal(10, 20, { energy: 5000, storeCapacity: 5000 });
            expect(t.store.energy).toBe(5000);
            expect(t.storeCapacity).toBe(5000);
        });

        it('hits can be overridden', () => {
            const t = terminal(10, 20, { hits: 1500 });
            expect(t.hits).toBe(1500);
            expect(t.hitsMax).toBe(1500);
        });

        it('storeCapacityResource is ignored (simple mode)', () => {
            const t = terminal(10, 20, { storeCapacityResource: { energy: 150000 } });
            expect(t.storeCapacityResource).toBeUndefined();
        });
    });
});
