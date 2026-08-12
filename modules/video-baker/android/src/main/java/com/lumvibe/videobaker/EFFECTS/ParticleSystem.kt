package com.lumvibe.videobaker

import kotlin.random.Random

/**
* Real physics simulation — position, velocity, gravity, rotation, finite
* lifetime per particle. This is the CPU-simulated counterpart to shader-only
* ambient effects like SNOW_FALL: used where particles need to originate from
* a detected trigger point (a hand position) with individual velocity/rotation,
* not an ever-present procedural field.
*
* MAX_PARTICLES is a hard cap because the render side (FrameRenderer +
* EffectShaders.throwConfetti) uploads particle data as FIXED-SIZE uniform
* arrays — GLSL ES 1.00 has no dynamic array sizes. 24 is a deliberate choice:
* enough for a visually rich confetti burst, still cheap enough for a
* fixed-size uniform upload + shader loop on the lower-end Android hardware
* section 19 of the brief specifically asks to respect. This number is
* duplicated (not shared via import) in EffectShaders.kt's PARTICLE_MAX
* constant — same "documented duplicate constant" convention that file
* already uses for GAZE_TRAIL_POINTS, not a new pattern invented here. If you
* change one, change both.
*/
class ParticleSystem(private val gravity: Float = 1.4f) {

    private data class Particle(
        var x: Float, var y: Float,
        var vx: Float, var vy: Float,
        var rotationDeg: Float, var rotationSpeedDegPerSec: Float,
        val lifetimeSec: Float, var ageSec: Float = 0f,
        val colorIndex: Int
    )

    private val particles = mutableListOf<Particle>()

    /**
     * Spawns [count] new particles at (originX, originY) — normalized 0..1
     * screen space, e.g. a detected palm position. Existing particles keep
     * simulating independently; this just adds more, up to MAX_PARTICLES total.
     */
    fun spawnBurst(originX: Float, originY: Float, count: Int, speed: Float, lifetimeSec: Float, random: Random = Random.Default) {
        repeat(count) {
            if (particles.size >= MAX_PARTICLES) return@repeat
            val angle = random.nextFloat() * (2f * kotlin.math.PI.toFloat())
            val magnitude = speed * (0.5f + random.nextFloat() * 0.5f)
            particles.add(
                Particle(
                    x = originX, y = originY,
                    vx = kotlin.math.cos(angle) * magnitude,
                    // Slight upward bias (negative vy = up, in normalized
                    // texcoord-style screen space this codebase already uses for
                    // every other position-anchored effect) so it reads as a
                    // genuine "throw" rather than an omnidirectional explosion.
                    vy = kotlin.math.sin(angle) * magnitude - speed * 0.4f,
                    rotationDeg = random.nextFloat() * 360f,
                    rotationSpeedDegPerSec = (random.nextFloat() - 0.5f) * 720f,
                    lifetimeSec = lifetimeSec * (0.7f + random.nextFloat() * 0.6f),
                    colorIndex = random.nextInt(6)
                )
            )
        }
    }

    /** Advances the simulation by [dtSec] — call once per processed frame with the actual elapsed time. */
    fun update(dtSec: Float) {
        if (dtSec <= 0f) return // guards against a bad/duplicate timestamp rather than corrupting physics with a negative step
        val iter = particles.iterator()
        while (iter.hasNext()) {
            val p = iter.next()
            p.ageSec += dtSec
            if (p.ageSec >= p.lifetimeSec) {
                iter.remove()
                continue
            }
            p.vy += gravity * dtSec
            p.x += p.vx * dtSec
            p.y += p.vy * dtSec
            p.rotationDeg += p.rotationSpeedDegPerSec * dtSec
        }
    }

    fun isEmpty(): Boolean = particles.isEmpty()

    /**
     * Packs the live particle set into the fixed-size arrays FrameRenderer
     * uploads as uniforms. Same "flatten to FloatArray, pass a count" pattern
     * VideoTranscoder/FrameRenderer already use for GAZE_TRAIL's point history,
     * extended with rotation, normalized remaining-life (for fade-out), and a
     * palette color index per particle.
     */
    fun toUniforms(): Uniforms {
        val positions = FloatArray(MAX_PARTICLES * 2)
        val rotations = FloatArray(MAX_PARTICLES)
        val lifeRemaining = FloatArray(MAX_PARTICLES) // 1 = just spawned, 0 = about to die
        val colorIndices = FloatArray(MAX_PARTICLES)
        val activeCount = particles.size.coerceAtMost(MAX_PARTICLES)
        for (i in 0 until activeCount) {
            val p = particles[i]
            positions[i * 2] = p.x
            positions[i * 2 + 1] = p.y
            rotations[i] = p.rotationDeg
            lifeRemaining[i] = (1f - p.ageSec / p.lifetimeSec).coerceIn(0f, 1f)
            colorIndices[i] = p.colorIndex.toFloat()
        }
        return Uniforms(positions, rotations, lifeRemaining, colorIndices, activeCount)
    }

    data class Uniforms(
        val positions: FloatArray,
        val rotations: FloatArray,
        val lifeRemaining: FloatArray,
        val colorIndices: FloatArray,
        val count: Int
    )

    companion object {
        const val MAX_PARTICLES = 24
    }
} 
