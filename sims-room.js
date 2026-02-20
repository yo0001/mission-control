// ===== SIMS ROOM ENGINE v1.0 =====
// Tomato's apartment: Bathroom | Kitchen | Bedroom/Office
// Full life simulation with needs, AI, and activities

class SimsRoom {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.W = 360; this.H = 144;
    canvas.width = this.W; canvas.height = this.H;
    this.ctx.imageSmoothingEnabled = false;
    this.frame = 0;

    // ===== NEEDS (behavioral drivers) =====
    const saved = this.loadState();
    this.needs = saved?.needs || {
      hunger: 75, hygiene: 80, bladder: 20, energy: 70, fun: 60, social: 50
    };

    // ===== PHYSIOLOGY =====
    this.body = saved?.body || {
      height: 130,          // cm (fixed)
      weight: 32.0,         // kg
      bodyFat: 22,          // %
      muscleMass: 20.0,     // kg
      temperature: 36.5,    // °C
      heartRate: 72,        // bpm
      systolic: 110,        // mmHg
      diastolic: 70,        // mmHg
      spo2: 98,             // %
      bloodSugar: 90,       // mg/dL
      basalMetabolism: 1100,// kcal/day
      calorieIntake: 0,     // kcal today
      caloriesBurned: 0,    // kcal today
      hydration: 70,        // %
      steps: 0,             // today
      sedentaryMin: 0,      // minutes today
      lastSleepHours: 7.5,  // hours of last sleep
    };

    // ===== ENVIRONMENT =====
    this.env = saved?.env || {
      roomTemp: 20,         // °C
      humidity: 45,         // %
      brightness: 30,       // %
    };
    this.roomEnvs = {
      bathroom: { temp: 26, humidity: 75, brightness: 90 },
      kitchen:  { temp: 24, humidity: 50, brightness: 80 },
      bedroom:  { temp: 20, humidity: 45, brightness: 30 },
    };

    // ===== MENTAL =====
    this.mental = saved?.mental || {
      stress: 30,           // %
      focus: 70,            // %
      happiness: 65,        // %
    };

    // ===== TIME =====
    this.lastDecayTime = Date.now();
    this.dayStartTime = saved?.dayStartTime || Date.now();
    this._bloodSugarSpike = 0; // post-meal spike tracker

    // ===== CHARACTER =====
    this.char = {
      x: 305, y: 83, // standing position (head top y)
      targetX: -1,
      targetY: 83,
      facing: 1, // 1=right, -1=left
      state: 'idle',
      nextState: null, // state to enter after walking
      actionTimer: 0,
      walkFrame: 0,
    };

    // ===== FURNITURE INTERACTION POINTS =====
    this.spots = {
      toilet:    { x: 22, y: 83 },
      bathtub:   { x: 58, y: 83 },
      sink:      { x: 96, y: 83 },
      fridge:    { x: 133, y: 83 },
      stove:     { x: 165, y: 83 },
      table:     { x: 200, y: 85 }, // sitting
      bed:       { x: 250, y: 83 },
      desk:      { x: 305, y: 83 },
      bookshelf: { x: 346, y: 83 },
    };

    // ===== ACTIVITY DEFINITIONS =====
    this.activities = {
      cook:     { spot: 'stove',     duration: 90*25, restores: null, next: 'eat' },
      eat:      { spot: 'table',     duration: 90*15, restores: { hunger: 40 } },
      bathe:    { spot: 'bathtub',   duration: 90*30, restores: { hygiene: 50 } },
      toilet:   { spot: 'toilet',    duration: 90*8,  restores: { bladder: -75 }, next: 'wash' },
      wash:     { spot: 'sink',      duration: 90*5,  restores: { hygiene: 8 } },
      sleep:    { spot: 'bed',       duration: 90*50, restores: { energy: 55 } },
      read:     { spot: 'bookshelf', duration: 90*18, restores: { fun: 30 } },
      type:     { spot: 'desk',      duration: 90*25, restores: { fun: 15, social: 15 } },
    };

    // ===== PARTICLES =====
    this.particles = [];
    this.tapAnim = 0;

    // ===== STARS =====
    this.stars = [];
    for (let i = 0; i < 12; i++) {
      this.stars.push({
        x: 272 + Math.random() * 44, y: 16 + Math.random() * 32,
        sp: 0.3 + Math.random() * 2
      });
    }

    // ===== MONITOR TEXT =====
    this.monitorLines = [
      '> systems online', '> heartbeat OK', '> thinking...',
      '> all nominal', '> needs: checking', '> backup done ✓'
    ];

    // ===== PRE-RENDER STATIC LAYERS =====
    this.bgCanvas = document.createElement('canvas');
    this.bgCanvas.width = this.W; this.bgCanvas.height = this.H;
    const bgCtx = this.bgCanvas.getContext('2d');
    bgCtx.imageSmoothingEnabled = false;
    this._drawBG(bgCtx);

    this.fgCanvas = document.createElement('canvas');
    this.fgCanvas.width = this.W; this.fgCanvas.height = this.H;
    const fgCtx = this.fgCanvas.getContext('2d');
    fgCtx.imageSmoothingEnabled = false;
    this._drawFG(fgCtx);

    // ===== AI STATE =====
    this.idleTimer = 0;
    this.decisionCD = 0;

    // ===== EVENTS =====
    canvas.addEventListener('click', e => {
      const rect = canvas.getBoundingClientRect();
      const sx = (e.clientX - rect.left) / rect.width * this.W;
      const sy = (e.clientY - rect.top) / rect.height * this.H;
      this._onTap(sx, sy);
    });

    // ===== PERIODIC SAVE =====
    setInterval(() => this.saveState(), 15000);
  }

  // ===== HELPERS =====
  R(ctx, x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }

  clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ===== PERSISTENCE =====
  loadState() {
    try {
      const s = localStorage.getItem('mc_sims_state');
      if (!s) return null;
      const d = JSON.parse(s);
      // Catch-up decay for offline time
      if (d._lastSave) {
        const elapsed = (Date.now() - d._lastSave) / 1000;
        if (elapsed > 60 && d.needs) this._offlineDecay(d, Math.min(elapsed, 7200));
      }
      return d;
    } catch { return null; }
  }

  saveState() {
    const d = {
      needs: this.needs, body: this.body, env: this.env, mental: this.mental,
      dayStartTime: this.dayStartTime, _lastSave: Date.now()
    };
    try { localStorage.setItem('mc_sims_state', JSON.stringify(d)); } catch {}
  }

  _offlineDecay(d, dt) {
    if (!d.needs) return;
    d.needs.hunger  = this.clamp((d.needs.hunger || 75)  - dt * 0.08, 0, 100);
    d.needs.hygiene = this.clamp((d.needs.hygiene || 80) - dt * 0.05, 0, 100);
    d.needs.bladder = this.clamp((d.needs.bladder || 20) + dt * 0.10, 0, 100);
    d.needs.energy  = this.clamp((d.needs.energy || 70)  - dt * 0.04, 0, 100);
    d.needs.fun     = this.clamp((d.needs.fun || 60)     - dt * 0.06, 0, 100);
    d.needs.social  = this.clamp((d.needs.social || 50)  - dt * 0.03, 0, 100);
  }

  // ===== FULL PHYSIOLOGY UPDATE =====
  _updatePhysiology(dt) {
    const n = this.needs, b = this.body, m = this.mental, e = this.env;
    const st = this.char.state;
    const C = (v, lo, hi) => this.clamp(v, lo, hi);

    // --- Environment based on character position ---
    const room = this.char.x < 112 ? 'bathroom' : this.char.x < 228 ? 'kitchen' : 'bedroom';
    const re = this.roomEnvs[room];
    e.roomTemp += (re.temp - e.roomTemp) * dt * 0.5;
    e.humidity += (re.humidity - e.humidity) * dt * 0.5;
    // Brightness follows time of day
    const hour = new Date().getHours() + new Date().getMinutes() / 60;
    const dayBright = hour >= 6 && hour <= 18 ? 70 + 30 * Math.sin((hour - 6) / 12 * Math.PI) : 10;
    e.brightness += (dayBright * (re.brightness / 80) - e.brightness) * dt * 0.3;

    // --- Needs decay (behavioral drivers) ---
    n.hunger  = C(n.hunger  - dt * 0.08, 0, 100);
    n.hygiene = C(n.hygiene - dt * 0.05, 0, 100);
    n.bladder = C(n.bladder + dt * 0.10, 0, 100);
    n.energy  = C(n.energy  - dt * 0.04, 0, 100);
    n.fun     = C(n.fun     - dt * 0.06, 0, 100);
    n.social  = C(n.social  - dt * 0.03, 0, 100);

    // --- Body temperature ---
    // Trends toward environment-influenced setpoint
    let tempTarget = 36.5;
    if (st === 'bathe') tempTarget = 37.2;  // warm bath
    else if (st === 'sleep') tempTarget = 36.1; // sleep thermoregulation
    else if (st === 'cook') tempTarget = 36.7; // near heat
    else if (st === 'walking') tempTarget = 36.8; // exercise
    // Room temp influence (cold room = body works harder)
    tempTarget += (e.roomTemp - 22) * 0.01;
    b.temperature += (tempTarget - b.temperature) * dt * 0.15;
    b.temperature = C(b.temperature, 35.5, 38.0);

    // --- Heart rate ---
    let hrTarget = 72;
    if (st === 'walking') hrTarget = 95;
    else if (st === 'cook') hrTarget = 80;
    else if (st === 'bathe') hrTarget = 85;
    else if (st === 'sleep') hrTarget = 55;
    else if (st === 'type') hrTarget = 68;
    else if (st === 'read') hrTarget = 64;
    // Stress raises HR
    hrTarget += m.stress * 0.15;
    // Low energy raises HR slightly (compensation)
    if (n.energy < 30) hrTarget += 8;
    b.heartRate += (hrTarget - b.heartRate) * dt * 0.8;
    b.heartRate = C(b.heartRate, 50, 150);

    // --- Blood pressure ---
    let sysTarget = 110, diaTarget = 70;
    if (st === 'walking') { sysTarget = 125; diaTarget = 78; }
    else if (st === 'sleep') { sysTarget = 100; diaTarget = 62; }
    sysTarget += m.stress * 0.12;
    if (b.hydration < 50) { sysTarget -= 8; diaTarget -= 5; } // dehydration → low BP
    b.systolic += (sysTarget - b.systolic) * dt * 0.3;
    b.diastolic += (diaTarget - b.diastolic) * dt * 0.3;
    b.systolic = C(b.systolic, 85, 145);
    b.diastolic = C(b.diastolic, 55, 95);

    // --- SpO2 ---
    let spo2Target = 98;
    if (st === 'walking') spo2Target = 97; // mild exertion
    if (st === 'sleep') spo2Target = 96;
    b.spo2 += (spo2Target - b.spo2) * dt * 0.2;
    b.spo2 = C(b.spo2, 92, 100);

    // --- Blood sugar ---
    // Post-meal spike decays
    if (this._bloodSugarSpike > 0) {
      b.bloodSugar += this._bloodSugarSpike * dt * 0.3;
      this._bloodSugarSpike *= (1 - dt * 0.3);
      if (this._bloodSugarSpike < 0.5) this._bloodSugarSpike = 0;
    }
    // Fasting: glucose trends toward 85
    const bsTarget = n.hunger < 30 ? 75 : 85;
    b.bloodSugar += (bsTarget - b.bloodSugar) * dt * 0.02;
    // Walking burns glucose
    if (st === 'walking') b.bloodSugar -= dt * 2;
    b.bloodSugar = C(b.bloodSugar, 60, 200);

    // --- Hydration ---
    b.hydration -= dt * 0.02; // passive loss
    if (st === 'walking') b.hydration -= dt * 0.04; // sweat
    if (st === 'bathe') b.hydration -= dt * 0.03; // bath sweat
    if (st === 'cook') b.hydration -= dt * 0.02; // heat
    b.hydration = C(b.hydration, 30, 100);

    // --- Calories ---
    // Basal metabolism burns calories continuously
    b.basalMetabolism = 800 + b.muscleMass * 15; // muscle-dependent BMR
    const bmrPerSec = b.basalMetabolism / 86400;
    b.caloriesBurned += bmrPerSec * dt;
    // Activity calories
    if (st === 'walking') b.caloriesBurned += dt * 0.08;
    else if (st === 'cook') b.caloriesBurned += dt * 0.03;
    else if (st === 'bathe') b.caloriesBurned += dt * 0.02;

    // --- Steps (walking only) ---
    if (st === 'walking') b.steps += dt * 2; // ~2 steps/sec

    // --- Sedentary time ---
    if (st === 'type' || st === 'read' || st === 'eat' || st === 'idle') {
      b.sedentaryMin += dt / 60;
    }

    // --- Weight (very slow change) ---
    // Net calorie balance affects weight over time (compressed timescale)
    const netCal = b.calorieIntake - b.caloriesBurned;
    b.weight += netCal * 0.0000001 * dt; // extremely slow
    b.weight = C(b.weight, 25, 45);

    // --- BMI (derived) ---
    // Not stored, calculated on read

    // --- Body fat & muscle ---
    // Sedentary → muscle slowly decreases
    if (b.sedentaryMin > 30) b.muscleMass -= dt * 0.00001;
    // Walking → muscle slowly increases
    if (st === 'walking') b.muscleMass += dt * 0.00002;
    b.muscleMass = C(b.muscleMass, 14, 28);
    // Body fat inversely tracks muscle relative to weight
    b.bodyFat = C(100 - (b.muscleMass / b.weight * 100) - 15, 12, 38);

    // --- Mental: Stress ---
    let stressD = 0;
    if (st === 'type') stressD += dt * 0.8;  // work stress
    if (st === 'bathe') stressD -= dt * 3;    // relaxing
    if (st === 'sleep') stressD -= dt * 1.5;
    if (st === 'read') stressD -= dt * 0.5;
    if (n.hunger < 20) stressD += dt * 0.5;   // hungry = stressed
    if (n.bladder > 80) stressD += dt * 1;     // urgent = stressed
    if (n.energy < 20) stressD += dt * 0.5;
    m.stress = C(m.stress + stressD, 0, 100);

    // --- Mental: Focus ---
    let focusD = 0;
    if (st === 'type') focusD += dt * 0.3;     // typing builds focus
    if (st === 'read') focusD += dt * 0.5;
    if (b.bloodSugar > 140) focusD -= dt * 1;  // sugar crash
    if (b.bloodSugar < 70) focusD -= dt * 1.5; // hypoglycemia
    if (b.hydration < 50) focusD -= dt * 0.5;
    if (n.energy < 25) focusD -= dt * 1;
    // Passive decay
    focusD -= dt * 0.1;
    m.focus = C(m.focus + focusD, 0, 100);

    // --- Mental: Happiness ---
    let happyD = 0;
    if (st === 'eat') happyD += dt * 1.5;
    if (st === 'bathe') happyD += dt * 1;
    if (st === 'read') happyD += dt * 0.5;
    if (n.social > 60) happyD += dt * 0.1;
    if (n.hunger < 20) happyD -= dt * 0.5;
    if (m.stress > 70) happyD -= dt * 0.5;
    // Passive slight decay
    happyD -= dt * 0.05;
    m.happiness = C(m.happiness + happyD, 0, 100);

    // === CROSS-PARAMETER INTERACTIONS ===
    // Dehydration → focus down, temp regulation worse
    if (b.hydration < 45) {
      m.focus -= dt * 0.3;
      b.temperature += dt * 0.02; // thermoregulation impaired
    }
    // High blood sugar → sleepiness
    if (b.bloodSugar > 150) {
      n.energy -= dt * 0.05;
    }
    // Stress → sleep quality (tracked as energy recovery rate in sleep)
    // High sedentary → energy drains faster
    if (b.sedentaryMin > 60) {
      n.energy -= dt * 0.01; // sitting fatigue
    }
  }

  // ===== AI DECISION =====
  _decide() {
    const n = this.needs;
    // Priority list: urgent needs first
    if (n.bladder > 80) return 'toilet';
    if (n.energy < 15) return 'sleep';
    if (n.hunger < 20) return 'cook';
    if (n.hygiene < 20) return 'bathe';
    if (n.bladder > 60) return 'toilet';
    if (n.hunger < 40) return 'cook';
    if (n.energy < 30) return 'sleep';
    if (n.hygiene < 40) return 'bathe';
    if (n.fun < 30) return Math.random() < 0.5 ? 'read' : 'type';
    if (n.social < 30) return 'type';
    // Nothing urgent — random activity
    const acts = ['read', 'type', 'cook'];
    return acts[Math.floor(Math.random() * acts.length)];
  }

  _startActivity(name) {
    const act = this.activities[name];
    if (!act) return;
    const spot = this.spots[act.spot];
    this.char.targetX = spot.x;
    this.char.targetY = spot.y;
    this.char.nextState = name;
    this.char.state = 'walking';
    this.char.facing = spot.x > this.char.x ? 1 : -1;
  }

  _finishActivity() {
    const name = this.char.state;
    const act = this.activities[name];
    const b = this.body, m = this.mental, n = this.needs;
    if (act && act.restores) {
      for (const [k, v] of Object.entries(act.restores)) {
        n[k] = this.clamp(n[k] + v, 0, 100);
      }
    }
    // === Physiology effects on activity completion ===
    switch (name) {
      case 'eat':
        this._bloodSugarSpike = 50; // blood sugar spike
        b.calorieIntake += 450;     // meal calories
        b.hydration = this.clamp(b.hydration + 8, 0, 100); // food has water
        m.happiness = this.clamp(m.happiness + 8, 0, 100);
        m.stress = this.clamp(m.stress - 5, 0, 100);
        break;
      case 'bathe':
        m.stress = this.clamp(m.stress - 15, 0, 100);
        m.happiness = this.clamp(m.happiness + 10, 0, 100);
        break;
      case 'sleep':
        b.lastSleepHours = act.duration / 90 / 60; // convert frames to "hours"
        m.focus = this.clamp(m.focus + 25, 0, 100);
        m.stress = this.clamp(m.stress - 20, 0, 100);
        b.sedentaryMin = 0; // reset after sleep
        break;
      case 'toilet':
        m.stress = this.clamp(m.stress - 8, 0, 100); // relief!
        b.hydration = this.clamp(b.hydration - 3, 0, 100);
        break;
      case 'wash':
        b.hydration = this.clamp(b.hydration + 5, 0, 100); // drink water at sink
        break;
      case 'type':
        b.sedentaryMin += 25; // 25 min of desk work
        break;
      case 'read':
        m.focus = this.clamp(m.focus + 10, 0, 100);
        break;
    }
    // Chain activity?
    if (act && act.next) {
      this._startActivity(act.next);
    } else {
      this.char.state = 'idle';
      this.idleTimer = 60 + Math.random() * 120; // 1-3 seconds before next decision
      this.decisionCD = this.idleTimer;
    }
  }

  // ===== MAIN UPDATE =====
  update() {
    const now = Date.now();
    const dt = (now - this.lastDecayTime) / 1000;
    if (dt > 0.01) {
      this._updatePhysiology(dt);
      this.lastDecayTime = now;
    }

    const ch = this.char;

    switch (ch.state) {
      case 'idle':
        this.decisionCD--;
        if (this.decisionCD <= 0) {
          const act = this._decide();
          this._startActivity(act);
        }
        break;

      case 'walking':
        const speed = 0.6;
        const dx = ch.targetX - ch.x;
        if (Math.abs(dx) < speed) {
          ch.x = ch.targetX;
          ch.y = ch.targetY;
          // Arrived — start the activity
          ch.state = ch.nextState;
          ch.actionTimer = this.activities[ch.nextState]?.duration || 300;
          ch.nextState = null;
        } else {
          ch.x += dx > 0 ? speed : -speed;
          ch.facing = dx > 0 ? 1 : -1;
          ch.walkFrame++;
        }
        break;

      default:
        // Activity in progress
        ch.actionTimer--;
        if (ch.actionTimer <= 0) {
          this._finishActivity();
        }
        break;
    }

    // Sync to dashboard DATA.needs
    this.syncNeeds();
  }

  syncNeeds() {
    if (typeof DATA === 'undefined') return;
    const n = this.needs, b = this.body, m = this.mental, e = this.env;
    const bmi = (b.weight / ((b.height / 100) ** 2)).toFixed(1);

    DATA.needs = [
      { id: 'hunger',  icon: '🍔', name: 'Hunger',  value: Math.round(n.hunger),  inverted: false, hint: n.hunger < 30 ? 'お腹すいた...' : '' },
      { id: 'hygiene', icon: '🧼', name: 'Hygiene', value: Math.round(n.hygiene), inverted: false, hint: n.hygiene < 30 ? 'シャワー浴びたい' : '' },
      { id: 'bladder', icon: '🚽', name: 'Bladder', value: Math.round(n.bladder), inverted: true,  hint: n.bladder > 70 ? 'やばい...' : '' },
      { id: 'energy',  icon: '⚡', name: 'Energy',  value: Math.round(n.energy),  inverted: false, hint: n.energy < 30 ? '眠い...' : '' },
      { id: 'fun',     icon: '🎮', name: 'Fun',     value: Math.round(n.fun),     inverted: false, hint: n.fun < 30 ? '退屈〜' : '' },
      { id: 'social',  icon: '💬', name: 'Social',  value: Math.round(n.social),  inverted: false, hint: n.social < 30 ? 'よしあきと話したい' : '' },
    ];

    DATA.physiology = {
      vitals: [
        { icon: '🌡️', name: '体温',   value: b.temperature.toFixed(1), unit: '°C',   min: 35.5, max: 38, current: b.temperature },
        { icon: '💓', name: '心拍数',  value: Math.round(b.heartRate), unit: 'bpm',  min: 50, max: 150, current: b.heartRate },
        { icon: '🩸', name: '血圧',   value: `${Math.round(b.systolic)}/${Math.round(b.diastolic)}`, unit: 'mmHg' },
        { icon: '🫁', name: 'SpO2',   value: b.spo2.toFixed(1), unit: '%',    min: 90, max: 100, current: b.spo2 },
      ],
      body: [
        { icon: '📏', name: '身長', value: b.height, unit: 'cm' },
        { icon: '⚖️', name: '体重', value: b.weight.toFixed(1), unit: 'kg' },
        { icon: '📊', name: 'BMI',  value: bmi, unit: '' },
        { icon: '🔥', name: '体脂肪', value: b.bodyFat.toFixed(1), unit: '%' },
        { icon: '💪', name: '筋肉量', value: b.muscleMass.toFixed(1), unit: 'kg' },
      ],
      metabolism: [
        { icon: '🩸', name: '血糖値',   value: Math.round(b.bloodSugar), unit: 'mg/dL', min: 60, max: 200, current: b.bloodSugar, warn: b.bloodSugar > 140 || b.bloodSugar < 70 },
        { icon: '🔥', name: '基礎代謝', value: Math.round(b.basalMetabolism), unit: 'kcal/day' },
        { icon: '🍽️', name: '摂取Cal',  value: Math.round(b.calorieIntake), unit: 'kcal' },
        { icon: '🏃', name: '消費Cal',  value: Math.round(b.caloriesBurned), unit: 'kcal' },
        { icon: '💧', name: '水分量',   value: Math.round(b.hydration), unit: '%', min: 30, max: 100, current: b.hydration, warn: b.hydration < 50 },
      ],
      activity: [
        { icon: '👟', name: '歩数',     value: Math.round(b.steps), unit: '歩' },
        { icon: '🪑', name: '座位時間', value: Math.round(b.sedentaryMin), unit: '分', warn: b.sedentaryMin > 60 },
        { icon: '😴', name: '睡眠時間', value: b.lastSleepHours.toFixed(1), unit: 'h' },
      ],
      environment: [
        { icon: '🌡️', name: '室温',   value: e.roomTemp.toFixed(1), unit: '°C' },
        { icon: '💨', name: '湿度',   value: Math.round(e.humidity), unit: '%' },
        { icon: '☀️', name: '照度',   value: Math.round(e.brightness), unit: '%' },
      ],
      mental: [
        { icon: '😰', name: 'ストレス', value: Math.round(m.stress), unit: '%', min: 0, max: 100, current: m.stress, inverted: true, warn: m.stress > 70 },
        { icon: '🎯', name: '集中力',   value: Math.round(m.focus), unit: '%', min: 0, max: 100, current: m.focus, warn: m.focus < 30 },
        { icon: '😊', name: '幸福度',   value: Math.round(m.happiness), unit: '%', min: 0, max: 100, current: m.happiness },
      ],
    };
  }

  // ===== EXTERNAL EVENTS =====
  socialBoost(amount) { this.needs.social = this.clamp(this.needs.social + (amount || 20), 0, 100); }
  setState(s) { /* compatibility — external state hints */ }
  addLine(t) { this.monitorLines.push(t); if (this.monitorLines.length > 20) this.monitorLines.shift(); }

  // ===== TAP =====
  _onTap(sx, sy) {
    this.tapAnim = 40;
    this.needs.social = this.clamp(this.needs.social + 5, 0, 100);
    for (let i = 0; i < 5; i++) {
      this.particles.push({
        x: this.char.x + 3 + Math.random() * 6, y: this.char.y - 4,
        vx: (Math.random() - 0.5) * 0.6, vy: -0.5 - Math.random() * 0.3,
        life: 1, color: ['#ef4444', '#f97316', '#fcd34d', '#ec4899', '#a855f7'][i],
        ch: '♥', sz: 5, decay: 0.02
      });
    }
  }

  // ================================================================
  // ===== DRAWING: BACKGROUND (walls, floors, fixtures outlines) ====
  // ================================================================
  _drawBG(s) {
    const r = (x, y, w, h, c) => this.R(s, x, y, w, h, c);

    // ===== BATHROOM (0-112) =====
    // Wall
    r(0, 0, 113, 100, '#1a2840');
    for (let y = 0; y < 100; y += 10) for (let x = 0; x < 113; x += 14) {
      r(x, y, 13, 9, '#1e3050');
    }
    // Floor tiles
    for (let y = 101; y < 144; y += 7) for (let x = 0; x < 113; x += 9) {
      const light = ((x / 9 | 0) + (y / 7 | 0)) % 2 === 0;
      r(x, y, 8, 6, light ? '#b0c4de' : '#8faabe');
    }
    r(0, 99, 113, 2, '#4a6080'); // baseboard

    // Bathtub
    r(38, 62, 44, 30, '#e2e8f0'); // outer
    r(40, 64, 40, 26, '#dbeafe'); // inner
    r(40, 72, 40, 18, '#60a5fa'); // water
    r(40, 72, 40, 2, '#93c5fd'); // water surface
    r(38, 62, 44, 2, '#f8fafc'); // rim top
    r(38, 62, 2, 30, '#cbd5e1'); // left wall
    r(80, 62, 2, 30, '#cbd5e1'); // right wall
    r(76, 58, 4, 4, '#94a3b8'); // faucet
    r(78, 58, 2, 3, '#64748b');
    r(77, 56, 3, 2, '#94a3b8'); // faucet top
    // Legs
    r(40, 92, 3, 6, '#94a3b8'); r(78, 92, 3, 6, '#94a3b8');

    // Toilet
    r(10, 74, 18, 18, '#e2e8f0'); // base bowl
    r(12, 76, 14, 14, '#f0f9ff'); // inner
    r(8, 70, 22, 6, '#f8fafc'); // seat
    r(12, 62, 16, 10, '#e2e8f0'); // tank
    r(13, 60, 14, 4, '#f8fafc'); // tank lid
    r(19, 64, 4, 2, '#94a3b8'); // flush handle

    // Sink
    r(90, 76, 16, 8, '#e2e8f0'); // basin
    r(92, 78, 12, 4, '#dbeafe'); // water
    r(96, 84, 4, 14, '#94a3b8'); // pipe
    // Mirror
    r(89, 54, 18, 18, '#64748b'); // frame
    r(90, 55, 16, 16, '#c7d2fe'); // glass
    r(90, 55, 16, 2, '#ddd6fe'); // highlight

    // Towel rack
    r(4, 52, 2, 12, '#94a3b8');
    r(2, 52, 6, 1, '#94a3b8');
    r(2, 53, 5, 8, '#fca5a5'); // towel

    // Bath mat
    r(44, 96, 28, 4, '#c4b5fd');
    r(45, 97, 26, 2, '#a78bfa');

    // ===== WALL DIVIDER 1 =====
    r(112, 0, 5, 74, '#2d3748');
    r(112, 74, 5, 26, '#0f172a'); // doorway
    r(112, 0, 1, 100, '#3d4f66'); // highlight

    // ===== KITCHEN (117-228) =====
    // Wall
    r(117, 0, 112, 100, '#2a2518');
    for (let y = 0; y < 50; y += 12) r(117, y, 112, 1, '#342e20');
    // Wallpaper pattern (small dots)
    for (let y = 8; y < 48; y += 16) for (let x = 125; x < 225; x += 16) {
      r(x, y, 2, 2, '#3d3520');
    }
    // Floor (checkered warm)
    for (let y = 101; y < 144; y += 7) for (let x = 117; x < 229; x += 9) {
      const light = ((x / 9 | 0) + (y / 7 | 0)) % 2 === 0;
      r(x, y, 8, 6, light ? '#c4a882' : '#b09870');
    }
    r(117, 99, 112, 2, '#6b4226'); // baseboard

    // Fridge
    r(124, 48, 18, 44, '#94a3b8'); // body
    r(124, 48, 18, 2, '#b0bec5'); // top
    r(124, 48, 1, 44, '#78909c'); // shadow
    r(140, 48, 2, 44, '#78909c'); // right shadow
    r(124, 72, 18, 2, '#64748b'); // divider (freezer/fridge)
    r(139, 56, 2, 14, '#cbd5e1'); // handle top
    r(139, 76, 2, 14, '#cbd5e1'); // handle bottom
    // Magnets
    r(127, 52, 3, 3, '#ef4444');
    r(132, 54, 3, 3, '#3b82f6');
    r(128, 78, 3, 3, '#22c55e');

    // Counter + Stove
    r(150, 78, 36, 4, '#a07850'); // counter surface
    r(150, 78, 36, 1, '#b8926a'); // counter highlight
    r(150, 82, 36, 16, '#6b4226'); // counter body
    r(152, 86, 6, 3, '#4a3020'); // cabinet door 1
    r(160, 86, 6, 3, '#4a3020'); // cabinet door 2
    r(154, 87, 2, 1, '#8B6E4C'); // knob
    r(162, 87, 2, 1, '#8B6E4C'); // knob
    // Stove burners
    r(154, 78, 6, 1, '#333'); r(156, 77, 2, 1, '#555'); // burner 1
    r(166, 78, 6, 1, '#333'); r(168, 77, 2, 1, '#555'); // burner 2
    // Cabinet above
    r(150, 48, 36, 18, '#5c3a21');
    r(152, 50, 14, 14, '#4a3020'); r(168, 50, 14, 14, '#4a3020');
    r(158, 55, 2, 1, '#8B6E4C'); r(174, 55, 2, 1, '#8B6E4C');
    // Pot on stove
    r(153, 74, 10, 4, '#64748b'); // pot body
    r(151, 73, 14, 2, '#78909c'); // pot rim
    r(156, 72, 4, 2, '#94a3b8'); // handle

    // Table + chairs
    r(192, 82, 28, 2, '#8B6E4C'); // table top
    r(192, 82, 28, 1, '#a07850'); // highlight
    r(194, 84, 4, 14, '#6b4226'); // leg 1
    r(214, 84, 4, 14, '#6b4226'); // leg 2
    // Chair left
    r(189, 76, 3, 14, '#5c3a21'); // back
    r(188, 84, 6, 2, '#5c3a21'); // seat
    r(188, 86, 2, 12, '#4a3020'); // leg
    r(192, 86, 2, 12, '#4a3020'); // leg
    // Chair right
    r(220, 76, 3, 14, '#5c3a21');
    r(219, 84, 6, 2, '#5c3a21');
    r(219, 86, 2, 12, '#4a3020');
    r(223, 86, 2, 12, '#4a3020');
    // Fruit bowl on table
    r(202, 79, 8, 3, '#e2e8f0'); // bowl
    r(204, 78, 3, 2, '#ef4444'); // apple
    r(207, 78, 3, 2, '#eab308'); // banana

    // ===== WALL DIVIDER 2 =====
    r(228, 0, 5, 74, '#2d3748');
    r(228, 74, 5, 26, '#0f172a'); // doorway
    r(228, 0, 1, 100, '#3d4f66');

    // ===== BEDROOM/OFFICE (233-360) =====
    // Wall
    r(233, 0, 127, 100, '#16162a');
    for (let y = 0; y < 100; y += 12) r(233, y, 127, 1, '#1a1a30');
    // Floor (wood)
    for (let y = 101; y < 144; y += 5) {
      r(233, y, 127, 4, y % 10 < 5 ? '#5c3a21' : '#6b4226');
      r(233, y, 127, 1, '#4a3020');
    }
    for (let x = 233; x < 360; x += 28) {
      const off = (Math.floor((x - 233) / 28) % 2) * 14;
      for (let y = 101; y < 144; y += 10) r(x + off, y, 1, 5, '#3d2614');
    }
    r(233, 99, 127, 2, '#3d2614'); // baseboard

    // Bed
    r(238, 76, 32, 18, '#3b82f6'); // mattress/blanket
    r(238, 76, 32, 2, '#60a5fa'); // blanket top
    r(238, 74, 4, 20, '#5c3a21'); // headboard
    r(238, 74, 32, 2, '#6b4226'); // frame
    r(268, 74, 2, 20, '#5c3a21'); // footboard
    // Pillow
    r(240, 78, 10, 6, '#e2e8f0');
    r(241, 79, 8, 4, '#f8fafc');
    // Blanket fold
    r(252, 78, 16, 2, '#2563eb');
    // Bed legs
    r(239, 94, 3, 4, '#4a3020'); r(266, 94, 3, 4, '#4a3020');

    // Window
    r(276, 14, 46, 46, '#5c3a21'); // frame
    r(278, 16, 42, 42, '#0c1445'); // glass
    r(298, 16, 2, 42, '#5c3a21'); // middle bar
    r(278, 36, 42, 2, '#5c3a21'); // cross bar
    r(274, 58, 50, 4, '#6b4226'); // sill
    // Curtains
    r(277, 16, 4, 42, '#4a3060');
    r(317, 16, 4, 42, '#4a3060');
    for (let i = 0; i < 4; i++) { r(277, 16 + i * 10, 4, 2, '#5a4070'); r(317, 16 + i * 10, 4, 2, '#5a4070'); }

    // Bookshelf
    r(340, 18, 18, 74, '#5c3a21');
    r(342, 20, 14, 22, '#3d2614');
    r(342, 44, 14, 22, '#3d2614');
    r(342, 68, 14, 22, '#3d2614');
    r(340, 42, 18, 2, '#6b4226');
    r(340, 66, 18, 2, '#6b4226');
    // Books
    const bk = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899'];
    bk.forEach((c, i) => r(343 + i * 2, 22, 1, 18, c));
    bk.slice(0, 5).forEach((c, i) => r(343 + i * 2, 46, 1, 18, c));
    r(343, 70, 3, 18, '#ef4444'); r(347, 70, 3, 18, '#3b82f6'); r(351, 70, 3, 18, '#22c55e');
    // Trophy
    r(352, 82, 4, 8, '#fcd34d'); r(353, 80, 2, 2, '#fcd34d'); r(351, 88, 6, 2, '#d4a00a');

    // Chair back (behind character)
    r(302, 76, 3, 14, '#3d3d5c');
    r(304, 76, 1, 14, '#2d2d4a');

    // Wall clock
    r(340, 26, 12, 12, '#4a3020');
    r(341, 27, 10, 10, '#e2e8f0');

    // Poster
    r(234, 22, 22, 28, '#3d2614');
    r(236, 24, 18, 24, '#1a3a5c');
    r(238, 40, 14, 6, '#22c55e');

    // Rug
    r(282, 108, 50, 12, '#4a2040');
    r(283, 109, 48, 10, '#5c2854');
    r(286, 112, 42, 4, '#6b3068');
  }

  // ===== FOREGROUND (drawn OVER character for depth) =====
  _drawFG(s) {
    const r = (x, y, w, h, c) => this.R(s, x, y, w, h, c);

    // ===== BEDROOM DESK (foreground) =====
    // Chair seat + legs
    r(299, 88, 14, 3, '#3d3d5c'); r(299, 88, 14, 1, '#4d4d6c');
    r(301, 91, 2, 14, '#2d2d4a'); r(310, 91, 2, 14, '#2d2d4a');
    r(313, 82, 2, 8, '#3d3d5c'); // armrest

    // Desk surface
    r(282, 90, 58, 3, '#a07850'); r(282, 90, 58, 1, '#b8926a');
    // Desk body + legs
    r(282, 93, 58, 6, '#6b4226');
    r(284, 99, 4, 16, '#5c3a21'); r(334, 99, 4, 16, '#5c3a21');

    // Monitor
    r(300, 62, 32, 26, '#1a1a1a'); // bezel
    r(302, 64, 28, 22, '#0a1a0a'); // screen
    r(300, 62, 32, 1, '#333');
    r(314, 88, 6, 2, '#2a2a2a'); // stand base
    r(316, 86, 2, 2, '#333'); // stand neck
    r(330, 86, 2, 1, '#22c55e'); // LED

    // Keyboard
    r(296, 87, 22, 3, '#333');
    for (let kx = 297; kx < 317; kx += 3) { r(kx, 87, 2, 1, '#555'); r(kx, 89, 2, 1, '#444'); }
    // Mouse
    r(320, 88, 5, 3, '#444'); r(321, 88, 3, 1, '#666');

    // Coffee cup
    r(286, 84, 7, 6, '#e2e8f0'); r(284, 85, 2, 3, '#cbd5e1');
    r(287, 85, 5, 1, '#8B6E4C');

    // Plant
    r(330, 84, 7, 6, '#8B5E3C');
    r(332, 80, 3, 4, '#22c55e'); r(330, 78, 3, 3, '#16a34a');
    r(335, 79, 3, 2, '#22c55e');

    // GPT robot on desk
    r(324, 83, 7, 7, '#94a3b8'); r(325, 81, 5, 3, '#b0b8c4');
    r(327, 79, 1, 2, '#ef4444'); r(326, 79, 3, 1, '#f87171');
    r(326, 82, 1, 1, '#22c55e'); r(328, 82, 1, 1, '#22c55e');

    // ===== KITCHEN TABLE (foreground, so char can sit behind it) =====
    // (table drawn in BG for simplicity; chair hides char legs)

    // ===== BATHTUB RIM (foreground, so char appears "in" tub) =====
    // Only the near-side rim (front wall of tub)
    r(38, 88, 44, 4, '#e2e8f0');
    r(38, 88, 44, 1, '#f8fafc');
  }

  // ===== RENDER FRAME =====
  render() {
    const ctx = this.ctx;
    const f = this.frame;
    const r = (x, y, w, h, c) => this.R(ctx, x, y, w, h, c);

    // === LAYER 1: BACKGROUND ===
    ctx.drawImage(this.bgCanvas, 0, 0);

    // Stars in window
    this.stars.forEach(st => {
      const b = (Math.sin(f * 0.05 * st.sp + st.x) + 1) / 2;
      const a = Math.floor(60 + b * 195).toString(16).padStart(2, '0');
      if ((st.x < 298 || st.x > 300) && (st.y < 36 || st.y > 38))
        r(Math.round(st.x), Math.round(st.y), 1, 1, '#ffffff' + a);
    });
    // Moon
    r(310, 20, 4, 4, '#fcd34d'); r(312, 20, 3, 2, '#0c1445');

    // Clock hands
    const now = new Date();
    const hA = (now.getHours() % 12 + now.getMinutes() / 60) / 12;
    const mA = now.getMinutes() / 60;
    const cx = 346, cy = 32;
    r(cx, cy, 1, 1, '#333');
    r(cx + Math.round(Math.sin(hA * Math.PI * 2) * 3), cy - Math.round(Math.cos(hA * Math.PI * 2) * 3), 1, 1, '#333');
    r(cx + Math.round(Math.sin(mA * Math.PI * 2) * 4), cy - Math.round(Math.cos(mA * Math.PI * 2) * 4), 1, 1, '#999');

    // Dynamic kitchen effects
    // Stove fire (if cooking)
    if (this.char.state === 'cook') {
      if (f % 4 < 2) { r(155, 76, 4, 2, '#f97316'); r(167, 76, 4, 2, '#ef4444'); }
      else { r(156, 76, 3, 2, '#fbbf24'); r(168, 76, 3, 2, '#f97316'); }
      // Steam from pot
      for (let i = 0; i < 3; i++) {
        const sy = 68 - (f * 0.2 + i * 5) % 12;
        const sa = 1 - ((f * 0.2 + i * 5) % 12) / 12;
        if (sa > 0) { ctx.fillStyle = `rgba(200,200,220,${sa * 0.3})`; ctx.fillRect(157 + Math.sin(f * 0.1 + i) * 1.5, sy, 1, 1); }
      }
    }

    // Bathtub bubbles (if bathing)
    if (this.char.state === 'bathe') {
      for (let i = 0; i < 4; i++) {
        const bx = 44 + ((f * 0.3 + i * 9) % 32);
        const by = 70 + Math.sin(f * 0.05 + i) * 2;
        r(Math.round(bx), Math.round(by), 2, 2, 'rgba(255,255,255,0.4)');
      }
    }

    // === LAYER 2: CHARACTER ===
    this._drawCharacter(ctx, f);

    // === LAYER 3: FOREGROUND ===
    ctx.drawImage(this.fgCanvas, 0, 0);

    // === LAYER 4: DYNAMIC FOREGROUND ===
    // Monitor text (bedroom)
    if (this.char.state === 'type') {
      ctx.fillStyle = '#22c55e'; ctx.font = '4px monospace';
      const sl = Math.floor(f / 90) % this.monitorLines.length;
      for (let i = 0; i < 4; i++) {
        const li = (sl + i) % this.monitorLines.length;
        ctx.globalAlpha = i === 0 ? 0.5 : 1;
        ctx.fillText(this.monitorLines[li].substring(0, 12), 304, 70 + i * 4);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(34,197,94,.03)'; ctx.fillRect(302, 64, 28, 22);
    } else {
      // Dim monitor when not typing
      ctx.fillStyle = '#0a1a0a'; ctx.font = '4px monospace';
      ctx.fillStyle = '#1a4a1a'; ctx.fillText('> standby', 304, 74);
    }

    // Coffee steam (bedroom desk, when not sleeping)
    if (this.char.state !== 'sleep') {
      for (let i = 0; i < 2; i++) {
        const sy = 80 - (f * 0.3 + i * 8) % 14;
        const sa = 1 - ((f * 0.3 + i * 8) % 14) / 14;
        if (sa > 0) { ctx.fillStyle = `rgba(200,200,220,${sa * 0.25})`; ctx.fillRect(289 + Math.sin(f * 0.08 + i) * 1.5, sy, 1, 1); }
      }
    }

    // GPT robot eyes blink
    if (f % 200 > 195) { r(326, 82, 1, 1, '#064e3b'); r(328, 82, 1, 1, '#064e3b'); }
    else { r(326, 82, 1, 1, '#22c55e'); r(328, 82, 1, 1, '#22c55e'); }
    if (f % 30 < 15) r(327, 79, 1, 1, '#fca5a5');

    // Keyboard highlight when typing
    if (this.char.state === 'type' && f % 8 < 4)
      r(299 + (f % 5) * 3, 87, 2, 1, '#777');

    // === LAYER 5: PARTICLES ===
    this.particles = this.particles.filter(p => p.life > 0);
    this.particles.forEach(p => {
      p.x += p.vx || 0; p.y += p.vy || 0; p.life -= p.decay || 0.02;
      ctx.globalAlpha = Math.max(0, p.life);
      if (p.ch) { ctx.fillStyle = p.color; ctx.font = (p.sz || 5) + 'px sans-serif'; ctx.fillText(p.ch, p.x, p.y); }
      else { ctx.fillStyle = p.color; ctx.fillRect(Math.round(p.x), Math.round(p.y), p.w || 1, p.h || 1); }
    });
    ctx.globalAlpha = 1;

    // Tap animation countdown
    if (this.tapAnim > 0) this.tapAnim--;
    this.frame++;
  }

  // ===== CHARACTER DRAWING =====
  _drawCharacter(ctx, f) {
    const ch = this.char;
    const r = (x, y, w, h, c) => this.R(ctx, x, y, w, h, c);
    const cx = Math.round(ch.x);
    const cy = Math.round(ch.y);
    const tap = this.tapAnim > 0;
    const face = ch.facing;

    switch (ch.state) {
      case 'sleep': this._drawSleeping(ctx, r, f); return;
      case 'bathe': this._drawBathing(ctx, r, f); return;
      case 'toilet': this._drawToilet(ctx, r, f, cx, cy); return;
      case 'eat': this._drawEating(ctx, r, f); return;
    }

    // ===== STANDARD CHARACTER (standing/walking/working) =====
    const bob = ch.state === 'walking' ? Math.sin(f * 0.15) * 0.8 : Math.sin(f * 0.06) * 0.5;
    const dy = Math.round(bob);

    // Stem + leaves
    r(cx + 3, cy + dy - 2, 4, 2, '#15803d');
    r(cx + 4, cy + dy - 3, 2, 1, '#22c55e');
    r(cx + 2, cy + dy - 1, 2, 1, '#16a34a');
    r(cx + 6, cy + dy - 1, 2, 1, '#16a34a');

    // Head (tomato)
    r(cx + 1, cy + dy, 8, 7, '#ef4444');
    r(cx, cy + dy + 1, 10, 5, '#ef4444');
    r(cx + 1, cy + dy + 1, 8, 1, '#f87171'); // highlight

    // Face
    r(cx + 2, cy + dy + 3, 6, 3, '#fcd34d');

    // Eyes
    if (f % 160 < 4) {
      // Blink
      r(cx + 3, cy + dy + 3, 2, 1, '#92400e');
      r(cx + 6, cy + dy + 3, 2, 1, '#92400e');
    } else {
      r(cx + 3, cy + dy + 3, 2, 2, '#fff');
      r(cx + 6, cy + dy + 3, 2, 2, '#fff');
      // Pupils — look in facing direction
      const px = face > 0 ? 1 : 0;
      r(cx + 3 + px, cy + dy + 4, 1, 1, '#1e1b4b');
      r(cx + 6 + px, cy + dy + 4, 1, 1, '#1e1b4b');
      r(cx + 3, cy + dy + 3, 1, 1, '#fff'); // highlight
      r(cx + 6, cy + dy + 3, 1, 1, '#fff');
    }

    // Blush
    r(cx + 2, cy + dy + 4, 1, 1, '#fda4af');
    r(cx + 8, cy + dy + 4, 1, 1, '#fda4af');

    // Mouth
    if (tap) {
      r(cx + 4, cy + dy + 5, 3, 1, '#92400e');
      r(cx + 5, cy + dy + 6, 1, 1, '#92400e');
    } else if (ch.state === 'cook') {
      // Humming mouth
      r(cx + 5, cy + dy + 5, 2, 1, '#b91c1c');
      if (f % 30 < 15) r(cx + 4, cy + dy + 5, 1, 1, '#92400e'); // note
    } else {
      r(cx + 4, cy + dy + 5, 2, 1, '#b91c1c');
    }

    // Body
    r(cx + 2, cy + dy + 7, 6, 5, '#e2e8f0');
    r(cx + 2, cy + dy + 7, 6, 1, '#f8fafc');

    // Arms
    if (ch.state === 'walking') {
      const wf = Math.sin(f * 0.15) > 0;
      r(cx, cy + dy + 8, 2, wf ? 2 : 3, '#fcd34d');
      r(cx + 8, cy + dy + 8, 2, wf ? 3 : 2, '#fcd34d');
    } else if (ch.state === 'cook') {
      // Stirring
      const stir = f % 30 < 15;
      r(cx + 8, cy + dy + 7, 2, stir ? 2 : 3, '#fcd34d');
      r(cx, cy + dy + 8, 2, 3, '#fcd34d');
    } else if (ch.state === 'type') {
      const up = f % 16 < 8;
      r(cx, cy + dy + 8, 2, up ? 2 : 3, '#fcd34d');
      r(cx + 8, cy + dy + 8, 2, up ? 3 : 2, '#fcd34d');
    } else if (ch.state === 'read') {
      // Holding book
      r(cx, cy + dy + 8, 2, 3, '#fcd34d');
      r(cx + 8, cy + dy + 7, 2, 2, '#fcd34d');
      r(cx + 9, cy + dy + 5, 4, 3, '#3b82f6'); // book
    } else if (ch.state === 'wash') {
      r(cx + 8, cy + dy + 8, 2, 2, '#fcd34d');
      r(cx, cy + dy + 8, 2, 3, '#fcd34d');
    } else if (tap) {
      r(cx + 8, cy + dy + 7, 2, 2, '#fcd34d');
      r(cx + 9, cy + dy + 5, 2, 2, '#fcd34d');
      r(cx, cy + dy + 8, 2, 3, '#fcd34d');
    } else {
      // Idle arms
      r(cx, cy + dy + 8, 2, 3, '#fcd34d');
      r(cx + 8, cy + dy + 8, 2, 3, '#fcd34d');
    }

    // Legs
    if (ch.state === 'walking') {
      const wf = ch.walkFrame % 24;
      if (wf < 6) { r(cx + 2, cy + dy + 12, 3, 2, '#334155'); r(cx + 6, cy + dy + 12, 3, 3, '#334155'); }
      else if (wf < 12) { r(cx + 2, cy + dy + 12, 3, 3, '#334155'); r(cx + 6, cy + dy + 12, 3, 2, '#334155'); }
      else if (wf < 18) { r(cx + 2, cy + dy + 12, 3, 2, '#334155'); r(cx + 6, cy + dy + 12, 3, 3, '#334155'); }
      else { r(cx + 2, cy + dy + 12, 3, 3, '#334155'); r(cx + 6, cy + dy + 12, 3, 2, '#334155'); }
    } else {
      r(cx + 2, cy + dy + 12, 3, 2, '#334155');
      r(cx + 6, cy + dy + 12, 3, 2, '#334155');
    }

    // Feet
    r(cx + 1, cy + dy + 14, 3, 1, '#5c3a21');
    r(cx + 6, cy + dy + 14, 3, 1, '#5c3a21');

    // State effects
    if (ch.state === 'type' && f % 6 === 0)
      this._spawnSpark(298 + Math.random() * 16, 86);
    if (ch.state === 'read' && f % 40 === 0)
      this.particles.push({ x: cx + 12, y: cy - 2, vx: 0.1, vy: -0.2, life: 0.8, color: '#fcd34d', ch: '💡', sz: 4, decay: 0.015 });
    if (ch.state === 'cook' && f % 20 === 0)
      this.particles.push({ x: cx + 5, y: cy - 5, vx: (Math.random() - 0.5) * 0.2, vy: -0.2, life: 0.6, color: '#fcd34d', ch: '♪', sz: 4, decay: 0.015 });
    if (tap && f % 3 === 0)
      this.particles.push({ x: cx + 8 + Math.random() * 4, y: cy - 2, vx: (Math.random() - 0.5) * 0.5, vy: -0.4 - Math.random() * 0.3, life: 1, color: '#ef4444', ch: '♥', sz: 4, decay: 0.025 });

    // Idle — occasional thought bubble
    if (ch.state === 'idle' && f % 80 === 0)
      this._spawnBubble(cx + 5, cy - 5);

    // Need-based micro-animations
    if (this.needs.bladder > 70 && ch.state === 'idle' && f % 4 < 2) {
      r(cx + 2, cy + dy + 12, 3, 1, '#334155'); // leg jitter
    }
    if (this.needs.hunger < 20 && ch.state === 'idle' && f % 60 < 5) {
      this.particles.push({ x: cx + 5, y: cy - 3, vx: 0, vy: -0.15, life: 0.5, color: '#94a3b8', ch: '...', sz: 3, decay: 0.02 });
    }
    if (this.needs.social > 70 && f % 40 === 0) {
      this.particles.push({ x: cx + Math.random() * 10, y: cy - 3, vx: (Math.random() - 0.5) * 0.3, vy: -0.3, life: 0.8, color: '#fcd34d', ch: '✨', sz: 4, decay: 0.02 });
    }
  }

  // ===== SPECIAL ACTIVITY DRAWINGS =====

  _drawSleeping(ctx, r, f) {
    // Character in bed
    const bx = 244, by = 80;
    // Body under blanket (just a lump)
    r(bx + 4, by, 18, 4, '#3b82f6'); // blanket over body
    r(bx + 4, by, 18, 1, '#60a5fa');
    // Head on pillow
    r(bx + 1, by - 5, 8, 7, '#ef4444'); // head
    r(bx, by - 4, 10, 5, '#ef4444');
    r(bx + 1, by - 4, 8, 1, '#f87171');
    // Stem
    r(bx + 4, by - 7, 3, 2, '#15803d');
    // Face (sleeping)
    r(bx + 2, by - 2, 6, 3, '#fcd34d');
    r(bx + 3, by - 1, 2, 1, '#92400e'); // closed eyes
    r(bx + 6, by - 1, 2, 1, '#92400e');
    r(bx + 2, by, 1, 1, '#fda4af'); // blush
    r(bx + 8, by, 1, 1, '#fda4af');
    r(bx + 4, by + 1, 2, 1, '#b91c1c'); // mouth

    // ZZZ
    if (f % 60 === 0) {
      ['Z', 'z', 'Z'].forEach((c, i) => setTimeout(() => this.particles.push({
        x: bx + 14 + i * 3, y: by - 8 - i * 3,
        vx: 0.08, vy: -0.15, life: 1,
        color: '#94a3b8', ch: c, sz: 4 - i * 0.5, decay: 0.007
      }), i * 200));
    }

    // Breathing
    if (f % 80 < 40) r(bx + 4, by + 1, 18, 1, '#2563eb');
  }

  _drawBathing(ctx, r, f) {
    // Only head visible above bathtub
    const bx = 56, by = 66;
    // Head
    r(bx + 1, by, 8, 7, '#ef4444');
    r(bx, by + 1, 10, 5, '#ef4444');
    r(bx + 1, by + 1, 8, 1, '#f87171');
    // Stem
    r(bx + 4, by - 2, 3, 2, '#15803d');
    // Face
    r(bx + 2, by + 3, 6, 3, '#fcd34d');
    // Happy closed eyes (relaxed)
    r(bx + 3, by + 3, 2, 1, '#92400e');
    r(bx + 6, by + 3, 2, 1, '#92400e');
    // Blush
    r(bx + 2, by + 4, 1, 1, '#fda4af');
    r(bx + 8, by + 4, 1, 1, '#fda4af');
    // Smile
    r(bx + 4, by + 5, 3, 1, '#b91c1c');
    // Rubber duck
    r(bx + 14, by + 4 + Math.round(Math.sin(f * 0.05) * 0.5), 4, 3, '#fbbf24');
    r(bx + 17, by + 3 + Math.round(Math.sin(f * 0.05) * 0.5), 2, 2, '#fbbf24');
    r(bx + 18, by + 3, 1, 1, '#f97316'); // beak
    // Steam
    for (let i = 0; i < 4; i++) {
      const sy = 56 - (f * 0.15 + i * 5) % 18;
      const sa = 1 - ((f * 0.15 + i * 5) % 18) / 18;
      if (sa > 0) {
        ctx.fillStyle = `rgba(200,200,220,${sa * 0.2})`;
        ctx.fillRect(44 + i * 8 + Math.sin(f * 0.05 + i) * 2, sy, 2, 2);
      }
    }
    // Musical note (relaxing)
    if (f % 50 === 0)
      this.particles.push({ x: bx + 12, y: by - 4, vx: 0.15, vy: -0.2, life: 0.7, color: '#60a5fa', ch: '♪', sz: 4, decay: 0.012 });
  }

  _drawToilet(ctx, r, f, cx, cy) {
    // Standing next to toilet (simple, tasteful)
    const tx = 26;
    // Full character but looking down/reading phone
    this._drawStandingChar(ctx, r, f, tx, 83, false);
    // Phone in hand
    r(tx + 9, 88, 3, 4, '#1a1a2e');
    r(tx + 9, 88, 3, 1, '#3b82f6');
  }

  _drawEating(ctx, r, f) {
    // Sitting at kitchen table
    const ex = 200, ey = 85;
    const bob = Math.sin(f * 0.08) * 0.3;
    const dy = Math.round(bob);

    // Stem + leaves
    r(ex + 3, ey + dy - 2, 4, 2, '#15803d');
    r(ex + 4, ey + dy - 3, 2, 1, '#22c55e');
    // Head
    r(ex + 1, ey + dy, 8, 7, '#ef4444');
    r(ex, ey + dy + 1, 10, 5, '#ef4444');
    r(ex + 1, ey + dy + 1, 8, 1, '#f87171');
    // Face
    r(ex + 2, ey + dy + 3, 6, 3, '#fcd34d');
    // Eyes — happy eating
    if (f % 40 < 5) {
      r(ex + 3, ey + dy + 3, 2, 1, '#92400e');
      r(ex + 6, ey + dy + 3, 2, 1, '#92400e');
    } else {
      r(ex + 3, ey + dy + 3, 2, 2, '#fff');
      r(ex + 6, ey + dy + 3, 2, 2, '#fff');
      r(ex + 4, ey + dy + 4, 1, 1, '#1e1b4b');
      r(ex + 7, ey + dy + 4, 1, 1, '#1e1b4b');
    }
    r(ex + 2, ey + dy + 4, 1, 1, '#fda4af');
    r(ex + 8, ey + dy + 4, 1, 1, '#fda4af');
    // Mouth — chomping
    if (f % 20 < 10) r(ex + 4, ey + dy + 5, 3, 2, '#92400e');
    else r(ex + 4, ey + dy + 5, 2, 1, '#b91c1c');
    // Body (partial, sitting)
    r(ex + 2, ey + dy + 7, 6, 4, '#e2e8f0');
    // Arms — one holding chopstick/fork
    r(ex, ey + dy + 8, 2, 3, '#fcd34d');
    const armUp = f % 30 < 15;
    r(ex + 8, ey + dy + (armUp ? 6 : 8), 2, armUp ? 2 : 3, '#fcd34d');
    if (armUp) r(ex + 9, ey + dy + 4, 1, 3, '#94a3b8'); // chopstick
    // Plate on table
    r(ex + 3, ey + dy + 10, 8, 2, '#e2e8f0');
    r(ex + 4, ey + dy + 10, 6, 1, '#fca5a5'); // food

    // Yum particles
    if (f % 35 === 0) this.particles.push({
      x: ex + 5, y: ey - 4, vx: (Math.random() - 0.5) * 0.3, vy: -0.2,
      life: 0.6, color: '#f97316', ch: '😋', sz: 4, decay: 0.015
    });
  }

  // Generic standing character (used for toilet etc)
  _drawStandingChar(ctx, r, f, cx, cy, showWalk) {
    const bob = Math.sin(f * 0.06) * 0.5;
    const dy = Math.round(bob);
    // Stem
    r(cx + 3, cy + dy - 2, 4, 2, '#15803d');
    r(cx + 4, cy + dy - 3, 2, 1, '#22c55e');
    // Head
    r(cx + 1, cy + dy, 8, 7, '#ef4444');
    r(cx, cy + dy + 1, 10, 5, '#ef4444');
    r(cx + 1, cy + dy + 1, 8, 1, '#f87171');
    // Face
    r(cx + 2, cy + dy + 3, 6, 3, '#fcd34d');
    r(cx + 3, cy + dy + 3, 2, 2, '#fff');
    r(cx + 6, cy + dy + 3, 2, 2, '#fff');
    r(cx + 4, cy + dy + 4, 1, 1, '#1e1b4b');
    r(cx + 7, cy + dy + 4, 1, 1, '#1e1b4b');
    r(cx + 2, cy + dy + 4, 1, 1, '#fda4af');
    r(cx + 8, cy + dy + 4, 1, 1, '#fda4af');
    r(cx + 4, cy + dy + 5, 2, 1, '#b91c1c');
    // Body
    r(cx + 2, cy + dy + 7, 6, 5, '#e2e8f0');
    r(cx, cy + dy + 8, 2, 3, '#fcd34d');
    r(cx + 8, cy + dy + 8, 2, 3, '#fcd34d');
    // Legs
    r(cx + 2, cy + dy + 12, 3, 2, '#334155');
    r(cx + 6, cy + dy + 12, 3, 2, '#334155');
    r(cx + 1, cy + dy + 14, 3, 1, '#5c3a21');
    r(cx + 6, cy + dy + 14, 3, 1, '#5c3a21');
  }

  // ===== PARTICLE HELPERS =====
  _spawnBubble(px, py) {
    this.particles.push({ x: px, y: py, vx: -0.05 + Math.random() * 0.1, vy: -0.25, life: 1, color: 'rgba(255,255,255,0.6)', w: 3, h: 3, decay: 0.012 });
    this.particles.push({ x: px + 1, y: py + 3, vx: 0, vy: -0.1, life: 0.7, color: 'rgba(255,255,255,0.4)', w: 1, h: 1, decay: 0.015 });
  }

  _spawnSpark(px, py) {
    this.particles.push({ x: px, y: py - 1, vx: (Math.random() - 0.5) * 0.4, vy: -0.4 - Math.random() * 0.3, life: 1, color: '#22c55e', w: 1, h: 1, decay: 0.04 });
  }

  // ===== STATUS LABEL =====
  getStateLabel() {
    const labels = {
      idle: '● IDLE', walking: '● WALKING', cook: '● COOKING 🍳',
      eat: '● EATING 🍔', bathe: '● BATHING 🛁', toilet: '● TOILET 🚽',
      wash: '● WASHING 🧼', sleep: '● SLEEPING 💤', read: '● READING 📖',
      type: '● TYPING ⌨️'
    };
    return labels[this.char.state] || '● ' + this.char.state.toUpperCase();
  }

  getStateClass() {
    const s = this.char.state;
    if (s === 'sleep') return 'sleeping';
    if (s === 'idle' || s === 'read') return '';
    if (s === 'type' || s === 'cook' || s === 'walking') return '';
    return '';
  }
}