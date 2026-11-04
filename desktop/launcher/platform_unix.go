//go:build !windows

package main

import (
 "fmt"
 "os"
 "os/exec"
 "syscall"
)
func configureCommand(cmd *exec.Cmd) { cmd.SysProcAttr=&syscall.SysProcAttr{Setpgid:true} }
func processAlive(pid int) bool {e:=syscall.Kill(pid,0);return e==nil||e==syscall.EPERM}
func showError(message string) {fmt.Fprintln(os.Stderr,message)}
