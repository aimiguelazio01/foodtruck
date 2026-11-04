package main

import (
 "bufio"
 "context"
 "crypto/rand"
 "crypto/subtle"
 _ "embed"
 "encoding/hex"
 "encoding/json"
 "errors"
 "flag"
 "fmt"
 "io"
 "net"
 "net/http"
 "net/url"
 "os"
 "os/exec"
 "os/signal"
 "path/filepath"
 "runtime"
 "strconv"
 "strings"
 "sync"
 "syscall"
 "time"
)

//go:embed welcome.html
var welcome string
//go:embed welcome.js
var welcomeJS string

var version="1.1.0"
type State struct { State string `json:"state"`; Mode string `json:"mode"`; Message string `json:"message"`; URL string `json:"url"` }
type Control struct { URL string `json:"url"`; Token string `json:"token"` }
type Controller struct {mu sync.Mutex;state State;cmd *exec.Cmd;stdin io.WriteCloser;done chan error;root,data,token string;log io.Writer;browse bool;quit chan struct{} }
func (c *Controller) snapshot() State {c.mu.Lock();defer c.mu.Unlock();return c.state}
func (c *Controller) update(s State) {c.mu.Lock();c.state=s;c.mu.Unlock()}
func (c *Controller) stop() error {
 c.mu.Lock();if c.cmd==nil{c.mu.Unlock();return nil};input,done:=c.stdin,c.done;c.state=State{State:"stopping",Message:"A guardar dados e a encerrar…"};c.mu.Unlock()
 _,_ = io.WriteString(input,"stop\n")
 select {case <-done:c.mu.Lock();c.cmd=nil;c.stdin=nil;c.mu.Unlock();c.update(State{State:"idle",Message:"Escolha como pretende abrir a aplicação."});return nil
 case <-time.After(90*time.Second):return errors.New("A aplicação ainda está a encerrar. Aguarde e tente novamente.")}
}
func (c *Controller) start(mode string) {
 if err:=c.stop();err!=nil{c.update(State{State:"error",Message:err.Error()});return}
 c.update(State{State:"starting",Mode:mode,Message:"A preparar a aplicação…"})
 node:=filepath.Join(c.root,"runtime","node");if runtime.GOOS=="windows"{node+=".exe"}
 cmd:=exec.Command(node,filepath.Join(c.root,"desktop","runtime.mjs"),"--"+mode);cmd.Dir=c.root
 cmd.Env=append(os.Environ(),"FOODTRUCK_DATA_ROOT="+c.data);configureCommand(cmd)
 stdout,err:=cmd.StdoutPipe();if err!=nil{c.update(State{State:"error",Message:err.Error()});return};input,err:=cmd.StdinPipe();if err!=nil{c.update(State{State:"error",Message:err.Error()});return};cmd.Stderr=c.log
 if err=cmd.Start();err!=nil{c.update(State{State:"error",Message:"Não foi possível arrancar o motor da aplicação. Consulte o diagnóstico."});return}
 done:=make(chan error,1);c.mu.Lock();c.cmd=cmd;c.stdin=input;c.done=done;c.mu.Unlock()
 go func(){
  scanner:=bufio.NewScanner(stdout);scanner.Buffer(make([]byte,4096),1024*1024)
  for scanner.Scan(){var event struct{Type,Message,URL string};if json.Unmarshal(scanner.Bytes(),&event)!=nil{continue};switch event.Type{case "phase":c.update(State{State:"starting",Mode:mode,Message:event.Message});case "ready":c.update(State{State:"running",Mode:mode,Message:"Aplicação pronta.",URL:event.URL});if c.browse{openBrowser(event.URL)};case "error":c.update(State{State:"error",Mode:mode,Message:event.Message})}}
  err:=cmd.Wait();done<-err;current:=c.snapshot();if current.State!="stopping"&&current.State!="error"{c.update(State{State:"error",Mode:mode,Message:"A aplicação terminou. Pode voltar a abri-la; os dados foram preservados."})}
 }()
}
func (c *Controller) authorize(w http.ResponseWriter,r *http.Request) bool {
 w.Header().Set("Cache-Control","no-store");origin:=r.Header.Get("Origin");if origin!=""&&origin!="http://"+r.Host{http.Error(w,"Origem não permitida.",403);return false}
 if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Desktop-Token")),[]byte(c.token))!=1{http.Error(w,"Não autorizado.",403);return false};return true
}
func openBrowser(address string) {var cmd *exec.Cmd;switch runtime.GOOS{case "windows":cmd=exec.Command("rundll32","url.dll,FileProtocolHandler",address);case "darwin":cmd=exec.Command("open",address);default:cmd=exec.Command("xdg-open",address)};configureCommand(cmd);_ = cmd.Start()}
func dataDirectory() (string,error) {if runtime.GOOS=="linux"{if p:=os.Getenv("XDG_DATA_HOME");p!=""{return filepath.Join(p,"food-truck-live"),nil};home,e:=os.UserHomeDir();return filepath.Join(home,".local","share","food-truck-live"),e};p,e:=os.UserConfigDir();return filepath.Join(p,"FoodTruckLive"),e}
func payloadDirectory(executable string) string {dir:=filepath.Dir(executable);if runtime.GOOS=="darwin"{return filepath.Join(dir,"..","Resources","payload")};return filepath.Join(dir,"payload")}
func main(){if err:=run();err!=nil{showError(err.Error());os.Exit(1)}}
func run() error {
 quitOnly:=flag.Bool("quit",false,"Encerrar a instância existente");customData:=flag.String("data-dir","","Pasta privada de dados");noBrowser:=flag.Bool("no-browser",false,"Não abrir o navegador");printControl:=flag.Bool("print-control",false,"Mostrar endereço para testes");payload:=flag.String("payload","","Pasta do motor, para testes");flag.Parse()
 if runtime.GOOS!="windows"&&os.Geteuid()==0{return errors.New("Abra Food Truck Live com a sua conta de utilizador, sem sudo/root.")}
 data,err:=dataDirectory();if err!=nil{return err};if *customData!=""{data=*customData};data,err=filepath.Abs(data);if err!=nil{return err};if err=os.MkdirAll(data,0700);err!=nil{return err}
 controlFile,lockFile:=filepath.Join(data,"desktop-control.json"),filepath.Join(data,"desktop.lock")
 if *quitOnly {raw,e:=os.ReadFile(controlFile);if os.IsNotExist(e){return nil};if e!=nil{return e};var info Control;if json.Unmarshal(raw,&info)!=nil{return errors.New("Configuração de controlo inválida.")};u,e:=url.Parse(info.URL);if e!=nil||u.Hostname()!="127.0.0.1"||u.Scheme!="http"{return errors.New("Endereço de controlo inválido.")};req,_:=http.NewRequest("POST",info.URL+"/quit",nil);req.Header.Set("X-Desktop-Token",info.Token);client:=http.Client{Timeout:3*time.Second};response,e:=client.Do(req);if e!=nil{return nil};response.Body.Close();if response.StatusCode!=202{return errors.New("Aguarde o arranque antes de fechar a aplicação.")};for i:=0;i<180;i++{if _,e:=os.Stat(lockFile);os.IsNotExist(e){return nil};time.Sleep(500*time.Millisecond)};return errors.New("A aplicação ainda não terminou.")}
 existing:=func() bool {raw,e:=os.ReadFile(controlFile);if e!=nil{return false};var info Control;if json.Unmarshal(raw,&info)!=nil{return false};u,e:=url.Parse(info.URL);if e!=nil||u.Hostname()!="127.0.0.1"||u.Scheme!="http"{return false};req,_:=http.NewRequest("GET",info.URL+"/status",nil);req.Header.Set("X-Desktop-Token",info.Token);client:=http.Client{Timeout:time.Second};response,e:=client.Do(req);if e!=nil{return false};response.Body.Close();if response.StatusCode!=200{return false};if *printControl{fmt.Println(info.URL+"/#"+info.Token)};if !*noBrowser{openBrowser(info.URL+"/#"+info.Token)};return true}
 if raw,e:=os.ReadFile(lockFile);e==nil{pid,_:=strconv.Atoi(string(raw));if pid>0&&processAlive(pid){for n:=0;n<20;n++{if existing(){return nil};time.Sleep(250*time.Millisecond)};return errors.New("Food Truck Live já está a iniciar. Aguarde alguns segundos e volte a abrir o ícone.")};_ = os.Remove(lockFile)}
 lock,err:=os.OpenFile(lockFile,os.O_CREATE|os.O_EXCL|os.O_WRONLY,0600);if err!=nil{return errors.New("Não foi possível iniciar uma segunda instância.")};_,_=fmt.Fprint(lock,os.Getpid());lock.Close();defer os.Remove(lockFile)
 exe,err:=os.Executable();if err!=nil{return err};root:=payloadDirectory(exe);if *payload!=""{root=*payload};root,_=filepath.Abs(root)
 logfile,err:=os.OpenFile(filepath.Join(data,"desktop.log"),os.O_CREATE|os.O_WRONLY|os.O_APPEND,0600);if err!=nil{return err};defer logfile.Close()
 token:=make([]byte,32);if _,err=rand.Read(token);err!=nil{return err};c:=&Controller{root:root,data:data,token:hex.EncodeToString(token),log:logfile,browse:!*noBrowser,quit:make(chan struct{},1),state:State{State:"idle",Message:"Escolha como pretende abrir a aplicação."}}
 listener,err:=net.Listen("tcp","127.0.0.1:0");if err!=nil{return err};address:="http://"+listener.Addr().String()
 raw,_:=json.Marshal(Control{URL:address,Token:c.token});if err=os.WriteFile(controlFile,raw,0600);err!=nil{return err};defer os.Remove(controlFile)
 mux:=http.NewServeMux();mux.HandleFunc("/",func(w http.ResponseWriter,r *http.Request){if r.URL.Path!="/"{http.NotFound(w,r);return};w.Header().Set("Cache-Control","no-store");w.Header().Set("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'");w.Header().Set("Content-Type","text/html; charset=utf-8");_,_=io.WriteString(w,strings.ReplaceAll(welcome,"__VERSION__",version))})
 mux.HandleFunc("/welcome.js",func(w http.ResponseWriter,r *http.Request){w.Header().Set("Content-Type","application/javascript; charset=utf-8");_,_=io.WriteString(w,welcomeJS)})
 mux.HandleFunc("/status",func(w http.ResponseWriter,r *http.Request){if !c.authorize(w,r){return};w.Header().Set("Content-Type","application/json");_=json.NewEncoder(w).Encode(c.snapshot())})
 var actions sync.Mutex
 mux.HandleFunc("/start",func(w http.ResponseWriter,r *http.Request){if r.Method!="POST"{http.Error(w,"Método inválido.",405);return};if !c.authorize(w,r){return};var body struct{Mode string};if json.NewDecoder(io.LimitReader(r.Body,1024)).Decode(&body)!=nil||(body.Mode!="demo"&&body.Mode!="system"){http.Error(w,"Escolha demo ou sistema.",400);return};if !actions.TryLock(){http.Error(w,"Aguarde a operação em curso.",409);return};c.update(State{State:"starting",Mode:body.Mode,Message:"A preparar a aplicação…"});go func(){defer actions.Unlock();c.start(body.Mode)}();w.WriteHeader(202)})
 mux.HandleFunc("/quit",func(w http.ResponseWriter,r *http.Request){if r.Method!="POST"||!c.authorize(w,r){return};if !actions.TryLock(){http.Error(w,"Aguarde o arranque antes de encerrar.",409);return};go func(){defer actions.Unlock();if err:=c.stop();err!=nil{c.update(State{State:"error",Message:err.Error()});return};c.quit<-struct{}{}}();w.WriteHeader(202)})
 server:=http.Server{Handler:mux,ReadHeaderTimeout:5*time.Second};go server.Serve(listener)
 if *printControl{fmt.Println(address+"/#"+c.token)};if !*noBrowser{openBrowser(address+"/#"+c.token)}
 signals:=make(chan os.Signal,1);signal.Notify(signals,os.Interrupt,syscall.SIGTERM);defer signal.Stop(signals)
 select {case <-c.quit:case <-signals:if err=c.stop();err!=nil{return err}}
 ctx,cancel:=context.WithTimeout(context.Background(),3*time.Second);defer cancel();_ = server.Shutdown(ctx);return nil
}
