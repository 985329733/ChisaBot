// chisabot-ssh：ChisaBot PC 电脑文件夹同步（P4b）在 Windows 上的 ssh 包装器（MIT，和 PC 客户端同一个许可证）。
//
// 复制成 userData\sync\bin\ssh\ssh.exe / scp.exe，Mutagen（MUTAGEN_SSH_PATH）和 git（GIT_SSH）调用它：
//   ssh.exe <参数…>              → 系统的 OpenSSH（CHISABOT_REAL_SSH，默认 %SystemRoot%\System32\OpenSSH\ssh.exe）
//                                   加上 -F <CHISABOT_SSH_CONFIG>（ChisaBot 自己的 ssh 配置，不碰用户的 ~/.ssh）
//   ssh.exe --chisabot-proxy 127.0.0.1:<端口> <工作区>
//                                → ProxyCommand：连 PC 客户端主进程的本机中转，第一行发「<CHISABOT_SYNC_SECRET> <工作区>」，
//                                   之后 stdin/stdout 原样对接。设备令牌一直在主进程里，不在这里、不在命令行里。
package main

import (
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

var brokerRe = regexp.MustCompile(`^127\.0\.0\.1:[0-9]{1,5}$`)
var wsRe = regexp.MustCompile(`^[A-Za-z0-9_-]{1,80}$`)

func fail(msg string, code int) {
	os.Stderr.WriteString("chisabot-ssh: " + msg + "\n")
	os.Exit(code)
}

func proxy(addr, ws string) {
	secret := os.Getenv("CHISABOT_SYNC_SECRET")
	if !brokerRe.MatchString(addr) || !wsRe.MatchString(ws) || secret == "" {
		fail("中转参数不对", 2)
	}
	conn, err := net.Dial("tcp", addr)
	if err != nil {
		fail("连不上 ChisaBot PC（同步需要客户端开着）："+err.Error(), 1)
	}
	if _, err := conn.Write([]byte(secret + " " + ws + "\n")); err != nil {
		fail(err.Error(), 1)
	}
	done := make(chan struct{}, 2)
	go func() {
		io.Copy(conn, os.Stdin)
		if tc, ok := conn.(*net.TCPConn); ok {
			tc.CloseWrite()
		}
		done <- struct{}{}
	}()
	go func() {
		io.Copy(os.Stdout, conn)
		done <- struct{}{}
	}()
	<-done
	conn.Close()
	os.Exit(0)
}

func main() {
	if len(os.Args) >= 4 && os.Args[1] == "--chisabot-proxy" {
		proxy(os.Args[2], os.Args[3])
	}
	real := os.Getenv("CHISABOT_REAL_SSH")
	if real == "" {
		real = filepath.Join(os.Getenv("SystemRoot"), "System32", "OpenSSH", "ssh.exe")
	}
	if strings.HasPrefix(strings.ToLower(filepath.Base(os.Args[0])), "scp") {
		real = filepath.Join(filepath.Dir(real), "scp.exe")
	}
	cfg := os.Getenv("CHISABOT_SSH_CONFIG")
	if cfg == "" {
		fail("缺少 CHISABOT_SSH_CONFIG", 255)
	}
	cmd := exec.Command(real, append([]string{"-F", cfg}, os.Args[1:]...)...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	if err := cmd.Run(); err != nil {
		if e, ok := err.(*exec.ExitError); ok {
			os.Exit(e.ExitCode())
		}
		fail(err.Error(), 255)
	}
}
