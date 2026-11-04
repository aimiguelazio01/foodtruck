package main

import (
 "bytes"
 "errors"
 "net/http/httptest"
 "os/exec"
 "testing"
)
func TestControlAuthorization(t *testing.T){
 c:=Controller{token:"private-session-token"}
 for _,test:=range []struct{name,token,origin string;allowed bool}{
  {"missing token","","",false},{"wrong token","other","",false},{"foreign origin","private-session-token","https://example.org",false},{"local interface","private-session-token","http://127.0.0.1:5000",true},{"native client","private-session-token","",true},
 }{t.Run(test.name,func(t *testing.T){r:=httptest.NewRequest("POST","http://127.0.0.1:5000/start",nil);r.Header.Set("X-Desktop-Token",test.token);r.Header.Set("Origin",test.origin);w:=httptest.NewRecorder();if c.authorize(w,r)!=test.allowed{t.Fatal("incorrect authorization")};if w.Header().Get("Cache-Control")!="no-store"{t.Fatal("private response was cacheable")}})}
}
type inputBuffer struct{bytes.Buffer}
func(i *inputBuffer)Close()error{return nil}
func TestFailedChildDoesNotBlockRetry(t *testing.T){
 done:=make(chan error,1);done<-errors.New("prior startup failure");input:=&inputBuffer{}
 c:=Controller{cmd:&exec.Cmd{},stdin:input,done:done,state:State{State:"error"}}
 if err:=c.stop();err!=nil{t.Fatal(err)};if c.cmd!=nil||c.snapshot().State!="idle"{t.Fatal("failed child was not released")};if input.String()!="stop\n"{t.Fatal("stop command not sent")}
}
