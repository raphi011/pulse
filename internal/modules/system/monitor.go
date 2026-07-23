// Package system provides the live CPU/memory/network sampler behind the
// system.stats widget. A persistent Monitor computes CPU% and network
// byte-rates as deltas since the previous sample, so one instance must live
// for the app's lifetime — fresh ones per call would always report 0.
package system

import (
	"strings"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/mem"
	gnet "github.com/shirou/gopsutil/v4/net"
)

type Payload struct {
	CPUPercent       float64 `json:"cpuPercent"`
	MemUsedBytes     uint64  `json:"memUsedBytes"`
	MemTotalBytes    uint64  `json:"memTotalBytes"`
	NetRxBytesPerSec float64 `json:"netRxBytesPerSec"`
	NetTxBytesPerSec float64 `json:"netTxBytesPerSec"`
}

type Monitor struct {
	mu      sync.Mutex
	lastNet time.Time
	lastRx  uint64
	lastTx  uint64
}

// NewMonitor primes the delta-based counters so the first Sample reports a
// delta, not the boot total. Note: cpu.Percent(0, …) keeps its previous-sample
// state in a gopsutil package-global, not in Monitor — construct at most one
// Monitor per process, or concurrent Samples will corrupt each other's deltas.
func NewMonitor() *Monitor {
	m := &Monitor{lastNet: time.Now()}
	m.netTotals()
	cpu.Percent(0, false)
	return m
}

// netTotals sums all real interfaces; loopback is chatter, not traffic.
func (m *Monitor) netTotals() (rx, tx uint64) {
	counters, err := gnet.IOCounters(true)
	if err != nil {
		return m.lastRx, m.lastTx
	}
	for _, c := range counters {
		if strings.HasPrefix(c.Name, "lo") {
			continue
		}
		rx += c.BytesRecv
		tx += c.BytesSent
	}
	m.lastRx, m.lastTx = rx, tx
	return rx, tx
}

func (m *Monitor) Sample() (Payload, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	var p Payload
	if pcts, err := cpu.Percent(0, false); err == nil && len(pcts) > 0 {
		p.CPUPercent = pcts[0]
	}
	vm, err := mem.VirtualMemory()
	if err != nil {
		return p, err
	}
	p.MemUsedBytes, p.MemTotalBytes = vm.Used, vm.Total

	prevRx, prevTx, prevAt := m.lastRx, m.lastTx, m.lastNet
	rx, tx := m.netTotals()
	m.lastNet = time.Now()
	if elapsed := m.lastNet.Sub(prevAt).Seconds(); elapsed > 0 && rx >= prevRx && tx >= prevTx {
		p.NetRxBytesPerSec = float64(rx-prevRx) / elapsed
		p.NetTxBytesPerSec = float64(tx-prevTx) / elapsed
	}
	return p, nil
}
