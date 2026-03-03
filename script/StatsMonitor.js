;((window) => {
    const DEFAULT_THRESHOLDS = {
        PACKET_LOSS_HIGH: 5,
        PACKET_LOSS_RECOVERY: 2,
        RTT_HIGH: 0.3,
        RTT_RECOVERY: 0.15,
        PLI_FIR_RATE_HIGH: 3,
        PLI_FIR_RATE_RECOVERY: 1,
        CONSECUTIVE_SAMPLES_TO_TRIGGER: 3
    }

    class StatsMonitor {
        
        constructor(options = {}) {
            this.thresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds }
            this.onLossy = options.onLossy || null
            this.onRecovery = options.onRecovery || null
            this.lastRtt = undefined
            this.reset()
        }

        reset() {
            this.state = {
                isLossy: false,
                previousPacketsSent: null,
                previousRetransmittedPacketsSent: null,
                previousPliCount: null,
                previousFirCount: null,
                lossySampleCount: 0,
                recoverySampleCount: 0
            }
            this.lastRtt = undefined
            this.lastPliFirRate = 0
        }

        getState() {
            return { ...this.state }
        }

        setThresholds(overrides) {
            Object.assign(this.thresholds, overrides)
        }

        setOnLossy(callback) {
            this.onLossy = callback
        }

        setOnRecovery(callback) {
            this.onRecovery = callback
        }

        calculatePacketLossRate(packetsSent, retransmittedPacketsSent) {
            if (this.state.previousPacketsSent === null) {
                this.state.previousPacketsSent = packetsSent
                this.state.previousRetransmittedPacketsSent = retransmittedPacketsSent
                return 0
            }

            const deltaPacketsSent = packetsSent - this.state.previousPacketsSent
            const deltaRetransmitted = retransmittedPacketsSent - this.state.previousRetransmittedPacketsSent

            this.state.previousPacketsSent = packetsSent
            this.state.previousRetransmittedPacketsSent = retransmittedPacketsSent

            if (deltaPacketsSent <= 0) return 0

            return (deltaRetransmitted / deltaPacketsSent) * 100
        }

        calculatePliFirRate(pliCount, firCount) {
            if (this.state.previousPliCount === null) {
                this.state.previousPliCount = pliCount
                this.state.previousFirCount = firCount
                return 0
            }

            const deltaPli = pliCount - this.state.previousPliCount
            const deltaFir = firCount - this.state.previousFirCount

            this.state.previousPliCount = pliCount
            this.state.previousFirCount = firCount

            return deltaPli + deltaFir
        }

        evaluateConditions(packetLossRate, rtt, pliFirRate) {
            const isCurrentlyBad = packetLossRate > this.thresholds.PACKET_LOSS_HIGH ||
                                   (rtt !== undefined && rtt > this.thresholds.RTT_HIGH) ||
                                   pliFirRate > this.thresholds.PLI_FIR_RATE_HIGH

            const isCurrentlyGood = packetLossRate < this.thresholds.PACKET_LOSS_RECOVERY &&
                                    (rtt === undefined || rtt < this.thresholds.RTT_RECOVERY) &&
                                    pliFirRate <= this.thresholds.PLI_FIR_RATE_RECOVERY

            if (!this.state.isLossy && isCurrentlyBad) {
                this.state.lossySampleCount++
                this.state.recoverySampleCount = 0

                if (this.state.lossySampleCount >= this.thresholds.CONSECUTIVE_SAMPLES_TO_TRIGGER) {
                    this.state.isLossy = true
                    this.state.lossySampleCount = 0
                    console.log('[monitor] Network conditions degraded - triggering onLossy')
                    if (typeof this.onLossy === 'function') {
                        this.onLossy({ packetLossRate, rtt, pliFirRate })
                    }
                }
            } else if (this.state.isLossy && isCurrentlyGood) {
                this.state.recoverySampleCount++
                this.state.lossySampleCount = 0

                if (this.state.recoverySampleCount >= this.thresholds.CONSECUTIVE_SAMPLES_TO_TRIGGER) {
                    this.state.isLossy = false
                    this.state.recoverySampleCount = 0
                    console.log('[monitor] Network conditions recovered - triggering onRecovery')
                    if (typeof this.onRecovery === 'function') {
                        this.onRecovery({ packetLossRate, rtt, pliFirRate })
                    }
                }
            } else {
                if (!isCurrentlyBad) this.state.lossySampleCount = 0
                if (!isCurrentlyGood) this.state.recoverySampleCount = 0
            }
        }

        process(data) {
            const { report } = data
            const { data: reportData } = report
            const isVideoOut = reportData.type === 'outbound-rtp' && reportData.kind === 'video'
            const isCandidatePair = reportData.type === 'candidate-pair'

            if (isCandidatePair) {
                const { availableOutgoingBitrate, currentRoundTripTime } = reportData
                this.lastRtt = currentRoundTripTime
                console.log('[stat] availableOutgoingBitrate', availableOutgoingBitrate)
                console.log('[stat] currentRoundTripTime', currentRoundTripTime)
                console.log('[stat] ========================================')
            }

            if (isVideoOut) {
                const {
                    estimatedBitrate,
                    framesEncoded,
                    framesSent,
                    packetsSent,
                    retransmittedPacketsSent,
                    pliCount = 0,
                    firCount = 0
                } = reportData

                const packetLossRate = this.calculatePacketLossRate(packetsSent, retransmittedPacketsSent)
                const pliFirRate = this.calculatePliFirRate(pliCount, firCount)
                this.lastPliFirRate = pliFirRate

                console.log('[stat] estimatedBitrate', estimatedBitrate)
                console.log('[stat] frames Encode/Sent', framesEncoded / framesSent)
                console.log('[stat] Packet Loss Rate', packetLossRate.toFixed(2) + '%')
                console.log('[stat] RTT', this.lastRtt)
                console.log('[stat] PLI/FIR Rate', pliFirRate, `(pli: ${pliCount}, fir: ${firCount})`)
                console.log('[stat] ========================================')

                this.evaluateConditions(packetLossRate, this.lastRtt, pliFirRate)
                return { estimatedBitrate, framesEncoded, framesSent, packetLossRate, rtt: this.lastRtt, pliFirRate }
            }
            return null
        }
    }

    window.StatsMonitor = StatsMonitor
})(window)
