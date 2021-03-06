+++
title = "Lambdaの非同期呼び出しとエラー"
date = "2021-04-01"
tags = ["Lambda"]
+++

Lambdaの非同期呼び出しの場合の動作について試したり読んだりしたことをまとめた。

そもそもLambdaには同期呼び出しと非同期呼び出しがあること自体を自分は知らなかったのだが、例えばSQSでトリガーされる場合は同期、SNSをサブスクライブする場合は非同期、と、普段から両方の呼び出しを自分も利用していたことになる。

このうち非同期については、手軽にストットリングエラーを発生させることができるので[CloudWatch Alarmでの実験](/aws/cdkcloudwatchalarm)で使ったのだが、それをしているときに、動作については知らないことばかりだったので、調べてみたことをこの記事に残しておくことにした。

色々な試行に使ったCDKのコードは[Githubのリポジトリ](https://github.com/suzukiken/cdklambda-asynchronous)にある。

コードとしては[この辺りの部分](https://github.com/suzukiken/cdklambda-asynchronous/blob/318f97c335b36bafc2e1dd4924ec3902c4527d6f/lib/cdklambda-asynchronous-stack.ts#L51-L54)の話になる。

```
reservedConcurrentExecutions: 1,
retryAttempts: 0,
maxEventAge: cdk.Duration.seconds(180),
deadLetterQueue: dead_letter_queue
```

## 二種類の同時実行

[AWSのドキュメント](https://docs.aws.amazon.com/ja_jp/lambda/latest/dg/configuration-concurrency.html)にあるようにLambda 関数の同時実行数の設定は二種類ある。

* リザーブド
* プロビジョンド

このうちプロビジョンドの方はとりあえず自分ではほとんど利用するシーンはないだろうと思ったので、この記事中でも触れない。なのでここではリザーブドについての話となる。

リザーブドの同時実行数を1にすると、Lambda関数のインスタンスは1つしか起動せず、1つのインスタンスの中で関数は1度に1つしか実行されないので、結果的に処理は1つしか同時に行われないことになる。（なお、これはそういう解釈を私は[この記事](https://docs.aws.amazon.com/lambda/latest/dg/invocation-scaling.html)などを読んでしてます、という意味です。間違ってたらすみません。）

逆にリザーブドの同時実行数を制限しない場合でかつ仕事が沢山ある場合、Lambdaは複数のインスタンスを立ち上げて、同時に処理をしようとする。リクエストが続いて投入されれば、そのインスタンスの数は増えてゆく。

そういうわけで、リザーブドの同時実行数を1に制限すると、逆に容易にスロットリングが発生する。

コードの中の`reservedConcurrentExecutions: 1`のところは同時実行数を1として設定している部分となる。

## 非同期だとキューイングされる

比較的容易にスロットリングが発生するとは言っても、それで呼び出し要求が破棄されるのではなく、非同期のLambdaはスロットリングが発生したら、そのイベントを一旦キューに入れ、後で呼び出すようになっている。

どれだけの期間そのイベントをキューに保持しているかは、60秒から6時間を指定できるが、デフォルトでは6時間になっているので、多くの場合処理はいつか行われ、破棄されないことが多いのだろう。

逆にこれを60秒に指定して、かつLambda関数の実行に時間がかかればと、イベントの保持期間内に処理がされないまま、Lambdaはそのイベントを破棄することになる。

コードの中の`maxEventAge: cdk.Duration.seconds(180)`のところはその保持期間を180秒としている部分となる。

## 破棄された場合はデッドレターキューで捕捉できる

その破棄されたイベントは無視してもいいし、デッドレターキューに突っ込んで、何かの処理をしてもいい。

サンプルのリポジトリのコードでは、デッドレターキューを経由してSlackに通知するようにしているので、前述の`reservedConcurrentExecutions`とか`maxEventAge`を変更して[実験用のコード](https://github.com/suzukiken/cdklambda-asynchronous/blob/master/test/invoke_lambda.py)で呼び出すと、しばらくしてSlackに通知が来たりして面白い。

ちなみに、今回試していて1点疑問のままになっていることがあって、maxEventAgeの時間の半分程度の時間で、デッドレターキューにメッセージが投げ込まれることだったが、そこをあまり追求しても得るものが無さそうに思って気にしないことにした。

なおデッドレターキューの設定は`deadLetterQueue: dead_letter_queue`の部分でしている。

## リトライ

Lambda関数の最大再試行回数は0から2を指定できる。

コード中では`retryAttempts: 0`がその指定箇所となる。

最初はよく意味を理解していなかったので、最大再試行回数を0に設定しておいて、AWSコンソールのモニタリングを確認すると、スロットリングが発生しているのに、なぜデッドレターキューにメッセージがこないのだろう、と疑問を持ったのだが、これは[この記事](https://aws.amazon.com/jp/about-aws/whats-new/2019/11/aws-lambda-supports-max-retry-attempts-event-age-asynchronous-invocations/)を見て理解できた（というかそういう解釈を自分がした）。

なぜDLQにメッセージが来ないのかというと、最大イベント経過時間（maxEventAge）は、**関数の実行前**にスロットルなどでエラーが発生したときに機能するのものであるのに対して、
最大再試行回数（retryAttempts）は、**関数の実行後**に関数自体でエラーが発生した場合に再試行を何度するかの設定なのだ。

つまりスロットリングエラーが起きた場合関数は実行されないのだから、最大再試行回数の指定は関係なく、Lambdaはキューにイベントがあるかぎり何度でも関数を実行しようとする。

最大再試行回数が指定するのは、Lambda関数が実行されてその中でエラーが発生した場合に、もう一度かあるいは二度、関数の実行を試すかそれとも諦めるかであって、逆にその試行回数が尽きると、maxEventAgeの設定に関係なく、デッドレターキューにメッセージが飛ぶことになる。

なかなか色々ありますね。
