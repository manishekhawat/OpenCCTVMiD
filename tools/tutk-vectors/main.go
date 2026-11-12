// Reference vectors for src/p2p/*.ts, produced by go2rtc's own pkg/tutk code
// (copied verbatim into ./tutk). Time-derived bytes are zeroed so the output
// is deterministic.
package main

import (
	"encoding/hex"
	"fmt"
	"encoding/json"
	"os"

	"vec/tutk"
)

type nopConn struct{ tutk.Session }

func main() {
	out := map[string]any{}
	h := hex.EncodeToString

	// TransCode on lengths that exercise the 16-byte blocks and every tail.
	tc := map[string]map[string]string{}
	for _, n := range []int{0, 1, 2, 3, 4, 5, 8, 15, 16, 17, 24, 31, 32, 33, 68, 100} {
		b := make([]byte, n)
		for i := range b {
			b[i] = byte(i*37 + 11)
		}
		enc := tutk.TransCodePartial(nil, b)
		dec := tutk.ReverseTransCodePartial(nil, b)
		tc[string(rune('A'+len(tc)))] = map[string]string{"plain": h(b), "trans": h(enc[:n]), "reverse": h(dec[:n])}
	}
	out["transcode"] = tc

	// XXTEA: the go2rtc unit-test vector plus one more.
	buf := []byte("WERhJxb87WF3zgPa")
	tutk.XXTEADecrypt(buf, buf, []byte("GAgDiwVPg2E4GMke"))
	buf2 := []byte{0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15}
	tutk.XXTEADecrypt(buf2, buf2, []byte("0123456789abcdef"))
	out["xxtea"] = []map[string]string{
		{"src": h([]byte("WERhJxb87WF3zgPa")), "key": "GAgDiwVPg2E4GMke", "dst": h(buf)},
		{"src": "000102030405060708090a0b0c0d0e0f", "key": "0123456789abcdef", "dst": h(buf2)},
	}

	sid := []byte{1, 2, 3, 4, 5, 6, 7, 8}
	uid := "ABCDEFGHJKLMNPQRSTUV"
	out["connect"] = map[string]string{
		"uid": uid, "sid": h(sid),
		"broadcast": h(tutk.ConnectByUID(1, uid, sid)),
		"direct":    h(tutk.ConnectByUID(2, uid, sid)),
	}

	out["icam"] = map[string]string{
		"loginAsk":  h(tutk.ICAM(0x0400be)),
		"withArgs":  h(tutk.ICAM(0x0400c0, 9, 8, 7, 0, 0, 0, 0, 1, 1, 1)),
	}

	s := tutk.NewSession16(nil, sid)
	cs0 := s.ClientStart(0, "admin", "")
	cs1 := s.ClientStart(1, "admin", "")
	for _, b := range [][]byte{cs0, cs1} {
		for i := 48; i < 52; i++ { // cmd[20:24] = unix ms
			b[i] = 0
		}
	}
	io1 := s.SendIOCtrl(0x0100, tutk.ICAM(0x0400be))
	for i := 48; i < 52; i++ {
		io1[i] = 0
	}
	out["session16"] = map[string]string{
		"clientStart0": h(cs0), "clientStart1": h(cs1), "ioctrlFirst": h(io1),
	}

	// MISS-over-TUTK Dafang commands: go2rtc pkg/xiaomi/miss/client.go
	// dafangRaw, copied verbatim below. The PTZ ones are the commented-out
	// helpers in that file, captured from a real isa.camera.df3.
	out["dafang"] = map[string]string{
		"quality_hd":  h(dafangRaw(0xff07d5, 0)),
		"video_start": h(dafangRaw(0xff07d8, 1, 1)),
		"left":        h(dafangRaw(0xff2404, 2, 0, 5)),
		"right":       h(dafangRaw(0xff2404, 1, 0, 5)),
		"up":          h(dafangRaw(0xff2404, 0, 2, 5)),
		"down":        h(dafangRaw(0xff2404, 0, 1, 5)),
		"stop":        h(dafangRaw(0xff2404, 0, 0, 5)),
		"auth":        h([]byte(fmt.Sprintf(`{"public_key":"%s","sign":"%s","uuid":"","support_encrypt":0}`, "aa", "bb"))),
	}

	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	_ = enc.Encode(out)
}

// verbatim from go2rtc pkg/xiaomi/miss/client.go
func dafangRaw(cmd uint32, args ...byte) []byte {
	payload := tutk.ICAM(cmd, args...)

	data := make([]byte, 4+len(payload)*2)
	copy(data, "\x7f\xff\xff\xff")
	hex.Encode(data[4:], payload)
	return data
}
