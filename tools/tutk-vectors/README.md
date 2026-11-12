# TUTK reference vectors

`main.go` produces `__tests__/tutkVectors.json` by running go2rtc's own
`pkg/tutk` code, unmodified, on fixed inputs.

To regenerate, copy these files from AlexxIT/go2rtc into `./tutk/`:

- `pkg/tutk/crypto.go`, `helpers.go`, `session16.go` verbatim
- `connect.go`: the `const (...)` blocks and `ConnectByUID` from `session0.go`
- `consts.go`: the message-kind `const (...)` block from `conn.go`

then `go run . > ../../__tests__/tutkVectors.json` with a `go.mod` declaring
`module vec`.
