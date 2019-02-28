
type Err = null | boolean | string


interface IStream {
    streamtype?: string;
}

interface Callback {
    (err: Err, data?: any): void;
}

interface AbortCb {
    (err: Err): void;
}

interface AsyncMapCb {
    (data: any, callback: Callback): void;
}

interface SourceStream extends IStream {
    (err: Err, callback: Callback): void;
}

interface SinkStream extends IStream {
    (source: SourceStream): void;
}

interface ThroughStream extends IStream { 
  source: SourceStream;
  sink: SinkStream;
}

type PullStream = SourceStream | SinkStream | ThroughStream


function abortCb(cb: Callback, abort: Err, onAbort?: AbortCb) {
  cb(abort)
  onAbort && onAbort(abort === true ? null: abort)
  return
}

function values<T> (array: T[], onAbort?: AbortCb): SourceStream {
  var i = 0
  return function (abort: Err, cb: Callback) {
    if(abort)
      return abortCb(cb, abort, onAbort)
    if(i >= array.length)
      cb(true)
    else
      cb(null, array[i++])
  }
}


function drain<T> (op: ((item: T) => boolean|void), done: (err: Err) => void): SinkStream {
  var read: SourceStream, abort: Err

  var abortfn = function (err?: Err, cb?: Callback) {
    abort = err || true
    if(read) return read(abort, cb || function () {})
  }

  function sink (_read: SourceStream): any {
    read = _read
    if(abort) return abortfn()
    //this function is much simpler to write if you
    //just use recursion, but by using a while loop
    //we do not blow the stack if the stream happens to be sync.
    ;(function next() {
        var loop = true, cbed = false
        while(loop) {
          cbed = false
          read(null, function (end, data) {
            cbed = true
            if(end = end || abort) {
              loop = false
              if(done) done(end === true ? null : end)
              else if(end && end !== true)
                throw end
            }
            else if(op && false === op(data) || abort) {
              loop = false
              read(abort || true, done || function () {})
            }
            else if(!loop){
              next()
            }
          })
          if(!cbed) {
            loop = false
            return
          }
        }
      })()
  }

  return sink
}


function reduce<T, U> (reducer: (acc: T,item: U) => T, acc: T, cb: Callback) {
  var sink = drain(function (data: U) {
    acc = reducer(acc, data)
  }, function (err) {
    cb(err, acc)
  })
  return sink
}

function collect<T> (cb: Callback) {
  return reduce(function (arr: T[], item: T): T[] {
    arr.push(item)
    return arr
  }, [], cb)
}


function pull (...rest: Array<PullStream>) {
  var length = arguments.length
  var a: any = arguments[0]
  if (a.length === 1) {
    var args: Array<any> | null = new Array(length)
    for(var i = 0; i < length; i++)
      args[i] = arguments[i]
    return function (read: SourceStream) {
      if (args == null) {
        throw new TypeError("partial sink should only be called once!")
      }

      // Grab the reference after the check, because it's always an array now
      // (engines like that kind of consistency).
      var ref: Array<any> = args
      args = null

      ref.unshift(read)
      return pull.apply(null, ref)
    }
  }

  var read: any = a

  if (read && typeof read.source === 'function') {
    read = read.source
  }

  for (var i = 1; i < length; i++) {
    var s = arguments[i]
    if (typeof s === 'function') {
      read = s(read)
    } else if (s && typeof s === 'object') {
      s.sink(read)
      read = s.source
    }
  }

  return read
}


pull(
  values<String>(['package.json', 'example.js']),
  collect(function (err, array) {
    console.log(array)
  })
)

