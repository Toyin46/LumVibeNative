package com.lumvibe.videobaker

import android.graphics.SurfaceTexture

/**
* Blocks until a SurfaceTexture's onFrameAvailable fires — used after posting a
* frame (a decoded video frame, or here, a Canvas-drawn bitmap) to a Surface, to
* know when updateTexImage() will actually have something new to pick up.
*
* This is the exact same pattern VideoTranscoder.kt already uses for decoder
* frames (as a private nested class there) — extracted here as its own file so
* ImageBaker can use it too without duplicating the class body. VideoTranscoder's
* own copy is left as-is; this is a new, additive file only.
*/
class FrameWaiter {
    private val lock = Object()
    private var frameAvailable = false

    fun listener(): SurfaceTexture.OnFrameAvailableListener =
        SurfaceTexture.OnFrameAvailableListener {
            synchronized(lock) {
                frameAvailable = true
                lock.notifyAll()
            }
        }

    fun await() {
        synchronized(lock) {
            var waits = 0
            while (!frameAvailable) {
                lock.wait(500)
                waits++
                if (waits > 20) throw RuntimeException("Timed out waiting for frame")
            }
            frameAvailable = false
        }
    }
}
