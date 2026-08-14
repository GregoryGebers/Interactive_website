    // ---- Movement tuning ---------------------------------------------------
    // Reworked for a responsive platformer feel (Mario / Hollow Knight):
    //   • acceleration-based horizontal movement, and it WORKS IN THE AIR
    //     (weaker than on the ground) — this is what kills the old sticky feel
    //   • press-to-jump with a variable height: tap = small hop, hold = full
    //     jump (the rise is cut short when you release — see keyup)
    //   • asymmetric gravity: floaty on the way up, snappier on the way down
    //   • coyote time (jump just after leaving a ledge) + jump buffering
    //     (press just before landing) so jumps rarely feel "eaten"
    //   • a Shift dash: a short fixed-speed horizontal burst, one per airtime
    // All values are world-units and seconds.
    const MOVE_SPEED = 165;        // top horizontal speed
    const ACCEL_GROUND = 1900;     // how fast you reach MOVE_SPEED on the ground
    const ACCEL_AIR = 1100;        // ... and in the air (lighter control)
    const FRICTION_GROUND = 1500;  // decel when no input, grounded
    const AIR_DRAG = 180;          // decel when no input, airborne (keeps momentum)
    // Jump strength starts at the existing base. Per-tier percentages are
    // loaded from shop.json so the level editor can tune them without code edits.
    const JUMP_REF = 340;               // previous full-jump strength (reference)
    const JUMP_BASE = JUMP_REF * 0.8;   // current base jump
    const GRAVITY_UP = 560;        // gravity while rising (Yv < 0): floaty
    const GRAVITY_DOWN = 1050;     // gravity while falling: snappier
    const MAX_FALL = 900;          // terminal fall speed
    const JUMP_CUT = 0.45;         // release-while-rising multiplies Yv by this
    const COYOTE_TIME = 0.10;      // grace window to still jump after a ledge
    const JUMP_BUFFER = 0.12;      // remember a jump press this long before landing
    // Dash percentage is also loaded from shop.json.
    const DASH_REF = 430;               // previous dash speed (reference)
    const DASH_BASE = DASH_REF * 0.75;  // current base dash
    const DASH_DURATION = 0.14;    // how long the burst lasts
    const DASH_COOLDOWN = 0.45;    // min time between dashes

    // Held-key input + timers driving the physics above.
    let inputLeft = false, inputRight = false, jumpHeld = false, shiftHeld = false, ctrlHeld = false, spaceHeld = false;
    let coyoteTimer = 0, jumpBufferTimer = 0;
    let isDashing = false, dashDir = 1, dashTimer = 0, dashCooldownTimer = 0, canDash = true;
    let airJumps = 0;   // remaining mid-air jumps (from the double-jump upgrade)
    let controlLockTimer = 0; // seconds remaining after being hit by a bat/sword
    let punchHoldStartedAt = 0; // performance.now() when the current Space-hold began

    function clearCombatInputs() {
      inputLeft = inputRight = jumpHeld = shiftHeld = ctrlHeld = spaceHeld = false;
      jumpBufferTimer = 0;
      isDashing = false;
    }
