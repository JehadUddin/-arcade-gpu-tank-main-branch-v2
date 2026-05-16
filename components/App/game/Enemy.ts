import { JOLT_LAYER_MOVING, JOLT_RVEC3_TO_VEC3, Gfx3Jolt, gfx3JoltManager } from '@lib/gfx3_jolt/gfx3_jolt_manager';
import { Gfx3Mesh } from '@lib/gfx3_mesh/gfx3_mesh';
import { Gfx3MeshJSM } from '@lib/gfx3_mesh/gfx3_mesh_jsm';
import { gfx3MeshRenderer } from '@lib/gfx3_mesh/gfx3_mesh_renderer';
import { Quaternion } from '@lib/core/quaternion';
import { UT } from '@lib/core/utils';
import { createBoxMesh, createUnitBoxMesh } from './GameUtils';

/**
 * The Enemy class represents an AI-controlled tank.
 * It uses static shared meshes for better performance across many instances.
 */
export class Enemy {
  static bodyMesh: Gfx3Mesh;
  static turretMesh: Gfx3Mesh;
  static barrelMesh: Gfx3Mesh;
  static trackLMesh: Gfx3Mesh;
  static trackRMesh: Gfx3Mesh;
  static engineMesh: Gfx3Mesh;
  static projMesh: Gfx3Mesh;
  static hpGreen: Gfx3Mesh;
  static hpRed: Gfx3Mesh;
  static initialized = false;

  /**
   * Initializes shared meshes for all enemy instances.
   * Supports falling back to procedural boxes if JSM files are missing.
   */
  static async initMeshes() {
    if (Enemy.initialized) return;
    
    const bodyJSM = new Gfx3MeshJSM();
    const turretJSM = new Gfx3MeshJSM();
    const barrelJSM = new Gfx3MeshJSM();

    try {
      await Promise.all([
        bodyJSM.loadFromFile('models/tank_body.jsm'),
        turretJSM.loadFromFile('models/tank_turret.jsm'),
        barrelJSM.loadFromFile('models/tank_barrel.jsm')
      ]);

      Enemy.bodyMesh = bodyJSM;
      Enemy.turretMesh = turretJSM;
      Enemy.barrelMesh = barrelJSM;
    } catch (e) {
      console.warn('Enemy: Failed to load JSM models, falling back to boxes.', e);
      
      const chassisColor: [number, number, number] = [0.8, 0.2, 0.2]; 
      const turretColor: [number, number, number] = [0.6, 0.1, 0.1];
      Enemy.bodyMesh = createBoxMesh(1.5, 0.6, 2.2, chassisColor);
      Enemy.turretMesh = createBoxMesh(1.1, 0.5, 1.1, turretColor);
      Enemy.barrelMesh = createBoxMesh(0.2, 0.2, 1.5, [0.2, 0.2, 0.2]);
    }

    const trackColor: [number, number, number] = [0.15, 0.15, 0.15];
    const engineColor: [number, number, number] = [0.2, 0.2, 0.2];
    Enemy.trackLMesh = createBoxMesh(0.4, 0.6, 2.4, trackColor);
    Enemy.trackRMesh = createBoxMesh(0.4, 0.6, 2.4, trackColor);
    Enemy.engineMesh = createBoxMesh(1.2, 0.4, 0.6, engineColor);
    Enemy.projMesh = createBoxMesh(0.6, 0.6, 0.6, [1.0, 0.2, 0.0]);
    Enemy.hpGreen = createUnitBoxMesh([0, 1, 0]);
    Enemy.hpRed = createUnitBoxMesh([1, 0, 0]);

    Enemy.initialized = true;
  }

  physicsBody: any;
  
  rotation: number = 0;
  velocity: number = 0;
  recoil: number = 0;
  shootCooldown: number = 0;
  hp: number = 100;
  currentUp: vec3 = [0, 1, 0];
  visualQuat: Quaternion = new Quaternion();
  
  constructor(x: number, y: number, z: number) {
    // Note: initMeshes should be called externally to wait for async loading
    if (!Enemy.initialized) {
       Enemy.initMeshes(); 
    }

    this.physicsBody = gfx3JoltManager.addBox({
      width: 2.0, height: 1.2, depth: 2.4, // Encompass body and tracks
      x, y: y + 2.0, z, // Drop from air to handle uneven terrain correctly
      motionType: Gfx3Jolt.EMotionType_Dynamic,
      layer: JOLT_LAYER_MOVING,
      settings: { 
          mAngularDamping: 15.0, 
          mLinearDamping: 2.0,
          mMassPropertiesOverride: 10000.0,
          mCenterOfMassOffset: new Gfx3Jolt.Vec3(0, -0.3, 0)
      }
    });
  }


  update(ts: number, targetPos: any): { didShoot: boolean, muzzlePos?: vec3, dir?: vec3 } {
    if (this.hp <= 0) return { didShoot: false };

    const speed = 10;
    const rotSpeed = 2.5;

    this.recoil -= (ts / 1000) * 5; 
    if (this.recoil < 0) this.recoil = 0;
    
    this.shootCooldown -= ts / 1000;

    // Jolt Logic
    const pos = this.physicsBody.body.GetPosition();

    if (pos.GetY() < -5.0) {
        this.hp = 0; // Destroy enemy if it falls off the map
        return { didShoot: false };
    }

    const qPhysics = this.physicsBody.body.GetRotation();
    const currentQuat = new Quaternion(qPhysics.GetW(), qPhysics.GetX(), qPhysics.GetY(), qPhysics.GetZ());
    
    const myPos = JOLT_RVEC3_TO_VEC3(pos);
    const dx = targetPos[0] - myPos[0];
    const dz = targetPos[2] - myPos[2];
    const dist = Math.sqrt(dx*dx + dz*dz);
    const PI2 = Math.PI * 2;
    let targetAngle = Math.atan2(-dx, -dz);
    
    // OBSTACLE AVOIDANCE
    const castStartY = pos.GetY() + 0.5;
    const qRot = Quaternion.createFromEuler(this.rotation, 0, 0, 'YXZ');
    const fLeft = qRot.rotateVector([-0.7, 0, -1.0]);
    const fRight = qRot.rotateVector([0.7, 0, -1.0]);
    
    const rayDist = 12.0;
    const lRay = gfx3JoltManager.createRay(pos.GetX(), castStartY, pos.GetZ(), pos.GetX() + fLeft[0] * rayDist, castStartY, pos.GetZ() + fLeft[2] * rayDist);
    const rRay = gfx3JoltManager.createRay(pos.GetX(), castStartY, pos.GetZ(), pos.GetX() + fRight[0] * rayDist, castStartY, pos.GetZ() + fRight[2] * rayDist);
    
    // Ignore hits that are too close (likely our own body) by enforcing fraction > 0.15
    const lHit = lRay.fraction < 1.0 && lRay.fraction > 0.15;
    const rHit = rRay.fraction < 1.0 && rRay.fraction > 0.15;
    
    let isAvoiding = false;
    if (lHit && !rHit) {
        targetAngle += 1.2;
        isAvoiding = true;
    } else if (rHit && !lHit) {
        targetAngle -= 1.2;
        isAvoiding = true;
    } else if (lHit && rHit) {
        targetAngle += lRay.fraction < rRay.fraction ? 1.5 : -1.5;
        isAvoiding = true;
    }

    let bodyYawDiff = ((targetAngle - this.rotation) % PI2 + PI2) % PI2;
    if (bodyYawDiff > Math.PI) bodyYawDiff -= Math.PI * 2;
    
    // Faster turning when avoiding obstacles
    const currentRotSpeed = isAvoiding ? rotSpeed * 1.5 : rotSpeed;
    this.rotation += Math.sign(bodyYawDiff) * Math.min(Math.abs(bodyYawDiff), currentRotSpeed * (ts / 1000));
    
    const uprightQuat = Quaternion.createFromEuler(this.rotation, 0, 0, 'YXZ');
    
    // STABILIZATION: Neutralize Pitch and Roll via Angular Velocity
    const currentUpVec = currentQuat.rotateVector([0, 1, 0]);
    const tiltErrorX = -currentUpVec[2]; 
    const tiltErrorZ = currentUpVec[0];  

    const currentForward = currentQuat.rotateVector([0, 0, -1]);
    const currentYaw = Math.atan2(-currentForward[0], -currentForward[2]);
    let physYawDiff = ((this.rotation - currentYaw) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    if (physYawDiff > Math.PI) physYawDiff -= Math.PI * 2;
    
    // Aggressively steer towards target yaw and stabilize Pitch/Roll
    const targetAngularVelY = physYawDiff * 15.0; 
    gfx3JoltManager.bodyInterface.SetAngularVelocity(
        this.physicsBody.body.GetID(), 
        new Gfx3Jolt.Vec3(tiltErrorX * 12.0, targetAngularVelY, tiltErrorZ * 12.0)
    );

    this.visualQuat = currentQuat;

    // Movement logic
    let throttle = 0;
    if (dist > 15) {
        throttle = 1; 
    } else if (dist < 10) {
        throttle = -0.5; 
    }

    const targetVelocity = throttle * speed;
    const isBraking = (throttle > 0 && this.velocity < 0) || (throttle < 0 && this.velocity > 0);
    const accelRate = throttle !== 0 ? (isBraking ? -20.0 : -6.0) : -15.0;
    const accelAlphaValue = 1.0 - Math.exp(accelRate * (ts / 1000));
    this.velocity = UT.LERP(this.velocity, targetVelocity, accelAlphaValue);

    // MOVEMENT STABILITY: Smoothed velocity matching using strictly Yaw forward
    const forwardVecActual = uprightQuat.rotateVector([0, 0, -1]);
    const currentJoltVel = this.physicsBody.body.GetLinearVelocity();
    
    const velAlpha = 1.0 - Math.exp(-20.0 * (ts / 1000));
    const targetVelX = forwardVecActual[0] * this.velocity;
    const targetVelZ = forwardVecActual[2] * this.velocity;

    gfx3JoltManager.bodyInterface.SetLinearVelocity(
        this.physicsBody.body.GetID(), 
        new Gfx3Jolt.Vec3(
            UT.LERP(currentJoltVel.GetX(), targetVelX, velAlpha), 
            currentJoltVel.GetY(), 
            UT.LERP(currentJoltVel.GetZ(), targetVelZ, velAlpha)
        )
    );
    
    let didShoot = false;
    let muzzlePos: vec3 | undefined = undefined;
    let dir: vec3 | undefined = undefined;

    // Shoot Logic
    if (dist < 40 && Math.abs(bodyYawDiff) < 0.2 && this.shootCooldown <= 0) {
        const muzzleData = this.getMuzzleData(this.visualQuat);
        muzzlePos = muzzleData.muzzlePos;
        dir = muzzleData.dir;
        this.shootCooldown = 2.5; // Slightly longer cooldown
        this.recoil = 1.0;
        didShoot = true;
    }
    
    return { didShoot, muzzlePos, dir };
  }

  
  getMuzzleData(q: Quaternion): { muzzlePos: vec3, dir: vec3 } {
    const direction = q.rotateVector([0, 0, -1]); 
    const currentRot = this.physicsBody.body.GetRotation();
    const bodyQ = new Quaternion(currentRot.GetW(), currentRot.GetX(), currentRot.GetY(), currentRot.GetZ());
    
    const visualRecoil = this.recoil > 0 ? this.recoil * 0.3 : 0;
    const barrelRelativePos = bodyQ.rotateVector([0, 0, -0.8 + visualRecoil]);
    const pos = this.physicsBody.body.GetPosition();
    const bPos = [pos.GetX() + barrelRelativePos[0], pos.GetY() + 0.45 + barrelRelativePos[1], pos.GetZ() + barrelRelativePos[2]];

    // Barrel length is 1.5, so half-length is 0.75. 
    // We add a small offset to ensure it's just outside the tip.
    const tipOffset = 0.85; 
    const startPos = [
      bPos[0] + direction[0] * tipOffset,
      bPos[1] + direction[1] * tipOffset,
      bPos[2] + direction[2] * tipOffset,
    ];
    
    return {
       muzzlePos: [startPos[0], startPos[1], startPos[2]] as vec3,
       dir: [direction[0], direction[1], direction[2]] as vec3
    };
  }

  draw(cameraYaw: number = 0) {
    if (this.hp <= 0) return;

    const scale: vec3 = [1, 1, 1];
    const ZERO: vec3 = [0,0,0];

    const pos = this.physicsBody.body.GetPosition();
    const q = this.visualQuat;
    
    // Mesh alignment: Physics box is 0.8 high, Body mesh is 0.6.
    // Center of physics is at 0.4 (local). To align mesh floor to physics floor:
    // MeshCenterY = PhysicsCenterY - (0.8/2 - 0.6/2) = PhysicsCenterY - 0.1.
    const origin: vec3 = [pos.GetX(), pos.GetY() - 0.1, pos.GetZ()];

    const matBody = UT.MAT4_TRANSFORM(origin, ZERO, scale, q);
    gfx3MeshRenderer.drawMesh(Enemy.bodyMesh, matBody);

    const trackOffsetL = q.rotateVector([-0.8, -0.1, 0]);
    const matTrackL = UT.MAT4_TRANSFORM([origin[0] + trackOffsetL[0], origin[1] + trackOffsetL[1], origin[2] + trackOffsetL[2]], ZERO, scale, q);
    gfx3MeshRenderer.drawMesh(Enemy.trackLMesh, matTrackL);

    const trackOffsetR = q.rotateVector([0.8, -0.1, 0]);
    const matTrackR = UT.MAT4_TRANSFORM([origin[0] + trackOffsetR[0], origin[1] + trackOffsetR[1], origin[2] + trackOffsetR[2]], ZERO, scale, q);
    gfx3MeshRenderer.drawMesh(Enemy.trackRMesh, matTrackR);

    const engineOffset = q.rotateVector([0, 0.2, 1.2]);
    const matEngine = UT.MAT4_TRANSFORM([origin[0] + engineOffset[0], origin[1] + engineOffset[1], origin[2] + engineOffset[2]], ZERO, scale, q);
    gfx3MeshRenderer.drawMesh(Enemy.engineMesh, matEngine);

    const turretOffset = q.rotateVector([0, 0.45, 0]);
    const matTurret = UT.MAT4_TRANSFORM([origin[0] + turretOffset[0], origin[1] + turretOffset[1], origin[2] + turretOffset[2]], ZERO, scale, q);
    gfx3MeshRenderer.drawMesh(Enemy.turretMesh, matTurret);

    const visualRecoil = this.recoil > 0 ? this.recoil * 0.3 : 0;
    const barrelRelativePos = q.rotateVector([0, 0, -0.8 + visualRecoil]);
    const matBarrel = UT.MAT4_TRANSFORM([origin[0] + turretOffset[0] + barrelRelativePos[0], origin[1] + turretOffset[1] + barrelRelativePos[1], origin[2] + turretOffset[2] + barrelRelativePos[2]], ZERO, scale, q);
    gfx3MeshRenderer.drawMesh(Enemy.barrelMesh, matBarrel);
  }

  drawHealthBar(origin: vec3, hp: number, maxHp: number, cameraYaw: number = 0) {
      const hpPercentage = Math.max(0, hp / maxHp);
      const barMesh = hpPercentage > 0.5 ? Enemy.hpGreen : Enemy.hpRed;
      
      const barWidth = 1.5;
      const barHeight = 0.2;
      const barDepth = 0.2;
      
      // Calculate scale
      const scaleX = barWidth * hpPercentage;
      
      // Billboarding
      const barRotation = Quaternion.createFromEuler(cameraYaw, 0, 0, 'YXZ');
      
      // Offset local
      const offsetLocal = [-(barWidth - scaleX) / 2, 0, 0] as vec3;
      const offsetWorld = barRotation.rotateVector(offsetLocal);
      
      const matBar = UT.MAT4_TRANSFORM(
          [origin[0] + offsetWorld[0], origin[1] + 2.5, origin[2] + offsetWorld[2]], 
          [0, 0, 0], 
          [scaleX, barHeight, barDepth], 
          barRotation
      );
      
      gfx3MeshRenderer.drawMesh(barMesh, matBar);
  }
}
