//go:build windows

package main

import (
 "os/exec"
 "syscall"
 "unsafe"
)

func configureCommand(cmd *exec.Cmd) { cmd.SysProcAttr=&syscall.SysProcAttr{HideWindow:true,CreationFlags:0x08000000} }
func processAlive(pid int) bool { h,e:=syscall.OpenProcess(0x1000,false,uint32(pid));if e!=nil{return false};defer syscall.CloseHandle(h);var code uint32;if syscall.GetExitCodeProcess(h,&code)!=nil{return false};return code==259 }
func showError(message string) { dll:=syscall.NewLazyDLL("user32.dll");text,_:=syscall.UTF16PtrFromString(message);title,_:=syscall.UTF16PtrFromString("Food Truck Live");dll.NewProc("MessageBoxW").Call(0,uintptr(unsafe.Pointer(text)),uintptr(unsafe.Pointer(title)),0x10) }
